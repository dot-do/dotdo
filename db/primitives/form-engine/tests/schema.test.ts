/**
 * Form Schema Definition Tests (RED Phase)
 *
 * Tests for form schema creation, field types, and schema validation
 */

import { describe, it, expect } from 'vitest'
import {
  createFormSchema,
  defineField,
  defineStep,
  FormSchemaBuilder,
  parseFormSchema,
  validateFormSchema,
} from '../schema'
import type { FormSchema, FormField, FieldType } from '../types'

describe('FormSchema', () => {
  describe('createFormSchema', () => {
    it('should create a basic form schema', () => {
      const schema = createFormSchema({
        id: 'contact-form',
        title: 'Contact Us',
        fields: [
          { id: 'name', type: 'text', label: 'Name' },
          { id: 'email', type: 'email', label: 'Email' },
        ],
      })

      expect(schema.id).toBe('contact-form')
      expect(schema.title).toBe('Contact Us')
      expect(schema.fields).toHaveLength(2)
    })

    it('should auto-generate id if not provided', () => {
      const schema = createFormSchema({
        title: 'My Form',
        fields: [],
      })

      expect(schema.id).toBeDefined()
      expect(typeof schema.id).toBe('string')
    })

    it('should set createdAt and updatedAt timestamps', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [],
      })

      expect(schema.createdAt).toBeInstanceOf(Date)
      expect(schema.updatedAt).toBeInstanceOf(Date)
    })

    it('should support version numbering', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        version: '1.0.0',
        fields: [],
      })

      expect(schema.version).toBe('1.0.0')
    })

    it('should support form metadata', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [],
        metadata: { category: 'survey', language: 'en' },
      })

      expect(schema.metadata?.category).toBe('survey')
      expect(schema.metadata?.language).toBe('en')
    })
  })

  describe('Field Types', () => {
    const fieldTypes: FieldType[] = [
      'text',
      'textarea',
      'number',
      'email',
      'phone',
      'url',
      'date',
      'time',
      'datetime',
      'select',
      'multiselect',
      'checkbox',
      'radio',
      'file',
      'signature',
      'payment',
      'rating',
      'slider',
      'hidden',
      'group',
    ]

    it.each(fieldTypes)('should support %s field type', (type) => {
      const field = defineField({
        id: 'test-field',
        type,
        label: 'Test Field',
      })

      expect(field.type).toBe(type)
      expect(field.id).toBe('test-field')
      expect(field.label).toBe('Test Field')
    })

    it('should create text field with all properties', () => {
      const field = defineField({
        id: 'name',
        type: 'text',
        label: 'Full Name',
        placeholder: 'Enter your name',
        helpText: 'Please enter your full legal name',
        required: true,
        minLength: 2,
        maxLength: 100,
        pattern: '^[a-zA-Z\\s]+$',
        autocomplete: 'name',
      })

      expect(field.type).toBe('text')
      expect(field.placeholder).toBe('Enter your name')
      expect(field.helpText).toBe('Please enter your full legal name')
      expect(field.required).toBe(true)
      expect(field.minLength).toBe(2)
      expect(field.maxLength).toBe(100)
      expect(field.pattern).toBe('^[a-zA-Z\\s]+$')
    })

    it('should create number field with min/max/step', () => {
      const field = defineField({
        id: 'age',
        type: 'number',
        label: 'Age',
        min: 0,
        max: 120,
        step: 1,
      })

      expect(field.type).toBe('number')
      expect(field.min).toBe(0)
      expect(field.max).toBe(120)
      expect(field.step).toBe(1)
    })

    it('should create select field with options', () => {
      const field = defineField({
        id: 'country',
        type: 'select',
        label: 'Country',
        options: [
          { value: 'us', label: 'United States' },
          { value: 'ca', label: 'Canada' },
          { value: 'uk', label: 'United Kingdom' },
        ],
        searchable: true,
        clearable: true,
      })

      expect(field.type).toBe('select')
      expect(field.options).toHaveLength(3)
      expect(field.searchable).toBe(true)
      expect(field.clearable).toBe(true)
    })

    it('should create file upload field with config', () => {
      const field = defineField({
        id: 'resume',
        type: 'file',
        label: 'Resume',
        upload: {
          maxSize: 5 * 1024 * 1024, // 5MB
          accept: ['application/pdf', 'application/msword'],
          maxFiles: 1,
        },
      })

      expect(field.type).toBe('file')
      expect(field.upload.maxSize).toBe(5 * 1024 * 1024)
      expect(field.upload.accept).toContain('application/pdf')
    })

    it('should create payment field with config', () => {
      const field = defineField({
        id: 'payment',
        type: 'payment',
        label: 'Payment',
        payment: {
          amount: 9900, // $99.00
          currency: 'usd',
          providers: ['stripe', 'paypal'],
        },
      })

      expect(field.type).toBe('payment')
      expect(field.payment.amount).toBe(9900)
      expect(field.payment.currency).toBe('usd')
    })

    it('should create rating field', () => {
      const field = defineField({
        id: 'satisfaction',
        type: 'rating',
        label: 'Satisfaction',
        maxRating: 5,
        allowHalf: true,
        icon: 'star',
      })

      expect(field.type).toBe('rating')
      expect(field.maxRating).toBe(5)
      expect(field.allowHalf).toBe(true)
    })

    it('should create slider field with marks', () => {
      const field = defineField({
        id: 'budget',
        type: 'slider',
        label: 'Budget',
        min: 0,
        max: 1000,
        step: 50,
        marks: [
          { value: 0, label: '$0' },
          { value: 500, label: '$500' },
          { value: 1000, label: '$1000' },
        ],
      })

      expect(field.type).toBe('slider')
      expect(field.marks).toHaveLength(3)
    })

    it('should create group field with nested fields', () => {
      const field = defineField({
        id: 'address',
        type: 'group',
        label: 'Address',
        fields: [
          { id: 'street', type: 'text', label: 'Street' },
          { id: 'city', type: 'text', label: 'City' },
          { id: 'zip', type: 'text', label: 'ZIP Code' },
        ],
        layout: 'grid',
        columns: 2,
      })

      expect(field.type).toBe('group')
      expect(field.fields).toHaveLength(3)
      expect(field.layout).toBe('grid')
      expect(field.columns).toBe(2)
    })

    it('should create signature field', () => {
      const field = defineField({
        id: 'signature',
        type: 'signature',
        label: 'Your Signature',
        width: 400,
        height: 200,
        penColor: '#000000',
      })

      expect(field.type).toBe('signature')
      expect(field.width).toBe(400)
      expect(field.height).toBe(200)
    })
  })

  describe('Multi-step Forms', () => {
    it('should create multi-step form schema', () => {
      const schema = createFormSchema({
        id: 'registration',
        title: 'Registration Form',
        steps: [
          {
            id: 'personal',
            title: 'Personal Information',
            fields: [
              { id: 'name', type: 'text', label: 'Name' },
              { id: 'email', type: 'email', label: 'Email' },
            ],
          },
          {
            id: 'account',
            title: 'Account Setup',
            fields: [
              { id: 'username', type: 'text', label: 'Username' },
              { id: 'password', type: 'text', label: 'Password' },
            ],
          },
        ],
      })

      expect(schema.steps).toHaveLength(2)
      expect(schema.steps![0].id).toBe('personal')
      expect(schema.steps![1].id).toBe('account')
    })

    it('should define a step with description', () => {
      const step = defineStep({
        id: 'intro',
        title: 'Introduction',
        description: 'Please tell us about yourself',
        fields: [{ id: 'bio', type: 'textarea', label: 'Bio' }],
      })

      expect(step.description).toBe('Please tell us about yourself')
    })

    it('should support optional steps', () => {
      const step = defineStep({
        id: 'optional-step',
        title: 'Additional Info',
        optional: true,
        fields: [],
      })

      expect(step.optional).toBe(true)
    })

    it('should support step conditions', () => {
      const step = defineStep({
        id: 'business-info',
        title: 'Business Information',
        conditions: [
          {
            when: { field: 'accountType', operator: 'equals', value: 'business' },
            action: 'show',
          },
        ],
        fields: [{ id: 'companyName', type: 'text', label: 'Company Name' }],
      })

      expect(step.conditions).toHaveLength(1)
    })
  })

  describe('FormSchemaBuilder', () => {
    it('should build schema using fluent API', () => {
      const schema = new FormSchemaBuilder('survey')
        .title('Customer Survey')
        .description('Help us improve')
        .field({ id: 'name', type: 'text', label: 'Name' })
        .field({ id: 'email', type: 'email', label: 'Email' })
        .build()

      expect(schema.id).toBe('survey')
      expect(schema.title).toBe('Customer Survey')
      expect(schema.description).toBe('Help us improve')
      expect(schema.fields).toHaveLength(2)
    })

    it('should build multi-step schema', () => {
      const schema = new FormSchemaBuilder('wizard')
        .title('Setup Wizard')
        .step({
          id: 'step1',
          title: 'Step 1',
          fields: [{ id: 'f1', type: 'text', label: 'Field 1' }],
        })
        .step({
          id: 'step2',
          title: 'Step 2',
          fields: [{ id: 'f2', type: 'text', label: 'Field 2' }],
        })
        .build()

      expect(schema.steps).toHaveLength(2)
    })

    it('should add settings', () => {
      const schema = new FormSchemaBuilder('form')
        .title('Form')
        .settings({
          submitText: 'Send',
          showProgress: true,
          allowDraft: true,
        })
        .build()

      expect(schema.settings?.submitText).toBe('Send')
      expect(schema.settings?.showProgress).toBe(true)
    })

    it('should add form-level conditions', () => {
      const schema = new FormSchemaBuilder('form')
        .title('Form')
        .condition({
          when: { field: 'agree', operator: 'equals', value: true },
          action: 'enable',
          target: 'submit',
        })
        .build()

      expect(schema.conditions).toHaveLength(1)
    })
  })

  describe('Schema Validation', () => {
    it('should validate a well-formed schema', () => {
      const schema = createFormSchema({
        id: 'valid',
        title: 'Valid Form',
        fields: [{ id: 'f1', type: 'text', label: 'Field' }],
      })

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject schema without id', () => {
      const result = validateFormSchema({ title: 'No ID' } as FormSchema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('id'))).toBe(true)
    })

    it('should reject schema without title', () => {
      const result = validateFormSchema({ id: 'test' } as FormSchema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('title'))).toBe(true)
    })

    it('should reject schema without fields or steps', () => {
      const result = validateFormSchema({ id: 'test', title: 'Test' } as FormSchema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('fields') || e.includes('steps'))).toBe(true)
    })

    it('should reject duplicate field ids', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'name', type: 'text', label: 'Name 1' },
          { id: 'name', type: 'text', label: 'Name 2' },
        ],
      })

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true)
    })

    it('should reject invalid field types', () => {
      const schema = {
        id: 'test',
        title: 'Test',
        fields: [{ id: 'f1', type: 'invalid-type', label: 'Invalid' }],
      } as unknown as FormSchema

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('type'))).toBe(true)
    })

    it('should validate nested fields in groups', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'group',
            type: 'group',
            label: 'Group',
            fields: [
              { id: 'nested1', type: 'text', label: 'Nested 1' },
              { id: 'nested1', type: 'text', label: 'Nested 2' }, // duplicate
            ],
          },
        ],
      })

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(false)
    })

    it('should validate select fields have options', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [{ id: 'select', type: 'select', label: 'Select' }],
      }) as FormSchema

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('options'))).toBe(true)
    })

    it('should validate file fields have upload config', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [{ id: 'file', type: 'file', label: 'File' }],
      }) as FormSchema

      const result = validateFormSchema(schema)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('upload'))).toBe(true)
    })
  })

  describe('Schema Parsing', () => {
    it('should parse JSON schema', () => {
      const json = JSON.stringify({
        id: 'parsed',
        title: 'Parsed Form',
        fields: [{ id: 'f1', type: 'text', label: 'Field' }],
      })

      const schema = parseFormSchema(json)
      expect(schema.id).toBe('parsed')
      expect(schema.fields).toHaveLength(1)
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseFormSchema('invalid json')).toThrow()
    })

    it('should throw on invalid schema structure', () => {
      expect(() => parseFormSchema('{}')).toThrow()
    })

    it('should parse object directly', () => {
      const obj = {
        id: 'direct',
        title: 'Direct',
        fields: [{ id: 'f1', type: 'text', label: 'F1' }],
      }

      const schema = parseFormSchema(obj)
      expect(schema.id).toBe('direct')
    })
  })

  describe('Default Values', () => {
    it('should set default values for fields', () => {
      const schema = createFormSchema({
        id: 'defaults',
        title: 'Defaults',
        fields: [
          { id: 'country', type: 'select', label: 'Country', defaultValue: 'us', options: [] },
          { id: 'subscribe', type: 'checkbox', label: 'Subscribe', defaultValue: true },
          { id: 'rating', type: 'rating', label: 'Rating', defaultValue: 3 },
        ],
      })

      expect(schema.fields![0].defaultValue).toBe('us')
      expect(schema.fields![1].defaultValue).toBe(true)
      expect(schema.fields![2].defaultValue).toBe(3)
    })
  })

  describe('Field Accessibility', () => {
    it('should support aria labels', () => {
      const field = defineField({
        id: 'email',
        type: 'email',
        label: 'Email',
        ariaLabel: 'Your email address for contact',
      })

      expect(field.ariaLabel).toBe('Your email address for contact')
    })

    it('should support help text', () => {
      const field = defineField({
        id: 'password',
        type: 'text',
        label: 'Password',
        helpText: 'Must be at least 8 characters',
      })

      expect(field.helpText).toBe('Must be at least 8 characters')
    })
  })
})
