import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  FormBuilder,
  FormValidator,
  ConditionalRenderer,
  FormSubmissionHandler,
  FileUploadHandler,
  FormVersioning,
  FormAnalytics,
} from './index'
import type {
  FormSchema,
  FormField,
  FieldType,
  ValidationRule,
  FormSubmission,
  ConditionalLogic,
  FormLayout,
} from './types'

// ============================================================================
// FormBuilder Tests
// ============================================================================

describe('FormBuilder', () => {
  let builder: FormBuilder

  beforeEach(() => {
    builder = new FormBuilder()
  })

  describe('field creation - all types', () => {
    test('adds text field', () => {
      builder.addField({
        name: 'username',
        type: 'text',
        label: 'Username',
      })

      const schema = builder.build()
      expect(schema.fields).toHaveLength(1)
      expect(schema.fields[0]).toMatchObject({
        name: 'username',
        type: 'text',
        label: 'Username',
      })
    })

    test('adds email field', () => {
      builder.addField({
        name: 'email',
        type: 'email',
        label: 'Email Address',
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('email')
    })

    test('adds number field', () => {
      builder.addField({
        name: 'age',
        type: 'number',
        label: 'Age',
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('number')
    })

    test('adds select field with options', () => {
      builder.addField({
        name: 'country',
        type: 'select',
        label: 'Country',
        options: [
          { value: 'us', label: 'United States' },
          { value: 'uk', label: 'United Kingdom' },
        ],
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('select')
      expect(schema.fields[0].options).toHaveLength(2)
    })

    test('adds checkbox field', () => {
      builder.addField({
        name: 'terms',
        type: 'checkbox',
        label: 'Accept Terms',
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('checkbox')
    })

    test('adds radio field with options', () => {
      builder.addField({
        name: 'gender',
        type: 'radio',
        label: 'Gender',
        options: [
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'other', label: 'Other' },
        ],
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('radio')
      expect(schema.fields[0].options).toHaveLength(3)
    })

    test('adds date field', () => {
      builder.addField({
        name: 'birthdate',
        type: 'date',
        label: 'Birth Date',
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('date')
    })

    test('adds file field', () => {
      builder.addField({
        name: 'resume',
        type: 'file',
        label: 'Upload Resume',
        accept: '.pdf,.doc,.docx',
        maxSize: 5 * 1024 * 1024, // 5MB
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('file')
      expect(schema.fields[0].accept).toBe('.pdf,.doc,.docx')
    })

    test('adds textarea field', () => {
      builder.addField({
        name: 'bio',
        type: 'textarea',
        label: 'Biography',
        rows: 5,
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('textarea')
      expect(schema.fields[0].rows).toBe(5)
    })

    test('adds rich-text field', () => {
      builder.addField({
        name: 'content',
        type: 'rich-text',
        label: 'Content',
      })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('rich-text')
    })
  })

  describe('field management', () => {
    test('removes field by name', () => {
      builder.addField({ name: 'field1', type: 'text', label: 'Field 1' })
      builder.addField({ name: 'field2', type: 'text', label: 'Field 2' })
      builder.removeField('field1')

      const schema = builder.build()
      expect(schema.fields).toHaveLength(1)
      expect(schema.fields[0].name).toBe('field2')
    })

    test('throws when removing non-existent field', () => {
      expect(() => builder.removeField('nonexistent')).toThrow(
        'Field "nonexistent" not found'
      )
    })

    test('updates existing field', () => {
      builder.addField({ name: 'email', type: 'text', label: 'Email' })
      builder.updateField('email', { type: 'email', label: 'Email Address' })

      const schema = builder.build()
      expect(schema.fields[0].type).toBe('email')
      expect(schema.fields[0].label).toBe('Email Address')
    })

    test('reorders fields', () => {
      builder.addField({ name: 'a', type: 'text', label: 'A' })
      builder.addField({ name: 'b', type: 'text', label: 'B' })
      builder.addField({ name: 'c', type: 'text', label: 'C' })
      builder.reorderFields(['c', 'a', 'b'])

      const schema = builder.build()
      expect(schema.fields.map((f) => f.name)).toEqual(['c', 'a', 'b'])
    })
  })

  describe('layout configuration', () => {
    test('sets single column layout', () => {
      builder.setLayout({ columns: 1 })

      const schema = builder.build()
      expect(schema.layout.columns).toBe(1)
    })

    test('sets multi-column layout', () => {
      builder.setLayout({ columns: 2 })

      const schema = builder.build()
      expect(schema.layout.columns).toBe(2)
    })

    test('configures sections', () => {
      builder.addField({ name: 'name', type: 'text', label: 'Name' })
      builder.addField({ name: 'email', type: 'email', label: 'Email' })
      builder.addField({ name: 'address', type: 'text', label: 'Address' })

      builder.setLayout({
        sections: [
          { title: 'Personal Info', fields: ['name', 'email'] },
          { title: 'Contact', fields: ['address'] },
        ],
      })

      const schema = builder.build()
      expect(schema.layout.sections).toHaveLength(2)
      expect(schema.layout.sections![0].title).toBe('Personal Info')
    })

    test('sets field ordering within layout', () => {
      builder.addField({ name: 'first', type: 'text', label: 'First' })
      builder.addField({ name: 'second', type: 'text', label: 'Second' })

      builder.setLayout({
        ordering: ['second', 'first'],
      })

      const schema = builder.build()
      expect(schema.layout.ordering).toEqual(['second', 'first'])
    })
  })

  describe('validation rules', () => {
    test('adds required validation', () => {
      builder.addField({
        name: 'name',
        type: 'text',
        label: 'Name',
        validation: [{ type: 'required', message: 'Name is required' }],
      })

      const schema = builder.build()
      expect(schema.fields[0].validation).toContainEqual({
        type: 'required',
        message: 'Name is required',
      })
    })

    test('adds pattern validation', () => {
      builder.addField({
        name: 'phone',
        type: 'text',
        label: 'Phone',
        validation: [
          {
            type: 'pattern',
            pattern: '^\\d{3}-\\d{3}-\\d{4}$',
            message: 'Invalid phone format',
          },
        ],
      })

      const schema = builder.build()
      expect(schema.fields[0].validation![0].type).toBe('pattern')
    })

    test('adds min/max validation for numbers', () => {
      builder.addField({
        name: 'age',
        type: 'number',
        label: 'Age',
        validation: [
          { type: 'min', value: 18, message: 'Must be at least 18' },
          { type: 'max', value: 120, message: 'Invalid age' },
        ],
      })

      const schema = builder.build()
      expect(schema.fields[0].validation).toHaveLength(2)
    })

    test('adds min/max length validation for strings', () => {
      builder.addField({
        name: 'password',
        type: 'text',
        label: 'Password',
        validation: [
          { type: 'minLength', value: 8, message: 'Minimum 8 characters' },
          { type: 'maxLength', value: 100, message: 'Maximum 100 characters' },
        ],
      })

      const schema = builder.build()
      expect(schema.fields[0].validation).toHaveLength(2)
    })

    test('adds custom validation function', () => {
      const customValidator = (value: unknown) => {
        if (typeof value === 'string' && value.includes('test')) {
          return 'Cannot contain "test"'
        }
        return null
      }

      builder.addField({
        name: 'username',
        type: 'text',
        label: 'Username',
        validation: [{ type: 'custom', validator: customValidator }],
      })

      const schema = builder.build()
      expect(schema.fields[0].validation![0].type).toBe('custom')
    })
  })

  describe('conditional logic', () => {
    test('adds showIf condition', () => {
      builder.addField({ name: 'hasJob', type: 'checkbox', label: 'Employed?' })
      builder.addField({
        name: 'company',
        type: 'text',
        label: 'Company',
        conditionalLogic: {
          showIf: { field: 'hasJob', equals: true },
        },
      })

      const schema = builder.build()
      expect(schema.fields[1].conditionalLogic?.showIf).toEqual({
        field: 'hasJob',
        equals: true,
      })
    })

    test('adds hideIf condition', () => {
      builder.addField({
        name: 'skipDetails',
        type: 'checkbox',
        label: 'Skip Details',
      })
      builder.addField({
        name: 'details',
        type: 'textarea',
        label: 'Details',
        conditionalLogic: {
          hideIf: { field: 'skipDetails', equals: true },
        },
      })

      const schema = builder.build()
      expect(schema.fields[1].conditionalLogic?.hideIf).toBeDefined()
    })

    test('adds enableIf condition', () => {
      builder.addField({
        name: 'newsletter',
        type: 'checkbox',
        label: 'Subscribe',
      })
      builder.addField({
        name: 'frequency',
        type: 'select',
        label: 'Frequency',
        conditionalLogic: {
          enableIf: { field: 'newsletter', equals: true },
        },
      })

      const schema = builder.build()
      expect(schema.fields[1].conditionalLogic?.enableIf).toBeDefined()
    })

    test('supports complex AND conditions', () => {
      builder.addField({
        name: 'premium',
        type: 'text',
        label: 'Premium Features',
        conditionalLogic: {
          showIf: {
            and: [
              { field: 'plan', equals: 'premium' },
              { field: 'verified', equals: true },
            ],
          },
        },
      })

      const schema = builder.build()
      expect(schema.fields[0].conditionalLogic?.showIf?.and).toHaveLength(2)
    })

    test('supports complex OR conditions', () => {
      builder.addField({
        name: 'discount',
        type: 'text',
        label: 'Discount Code',
        conditionalLogic: {
          showIf: {
            or: [
              { field: 'isStudent', equals: true },
              { field: 'isSenior', equals: true },
            ],
          },
        },
      })

      const schema = builder.build()
      expect(schema.fields[0].conditionalLogic?.showIf?.or).toHaveLength(2)
    })
  })

  describe('schema building', () => {
    test('builds complete schema with metadata', () => {
      builder.setMetadata({
        id: 'contact-form',
        name: 'Contact Form',
        version: '1.0.0',
      })
      builder.addField({ name: 'email', type: 'email', label: 'Email' })

      const schema = builder.build()
      expect(schema.id).toBe('contact-form')
      expect(schema.name).toBe('Contact Form')
      expect(schema.version).toBe('1.0.0')
    })

    test('builds immutable schema', () => {
      builder.addField({ name: 'test', type: 'text', label: 'Test' })
      const schema1 = builder.build()

      builder.addField({ name: 'test2', type: 'text', label: 'Test 2' })
      const schema2 = builder.build()

      expect(schema1.fields).toHaveLength(1)
      expect(schema2.fields).toHaveLength(2)
    })

    test('serializes schema to JSON', () => {
      builder.addField({ name: 'email', type: 'email', label: 'Email' })
      const schema = builder.build()

      const json = JSON.stringify(schema)
      const parsed = JSON.parse(json)

      expect(parsed.fields[0].name).toBe('email')
    })

    test('deserializes schema from JSON', () => {
      const json = JSON.stringify({
        id: 'test',
        name: 'Test Form',
        version: '1.0.0',
        fields: [{ name: 'email', type: 'email', label: 'Email' }],
        layout: { columns: 1 },
      })

      const schema = FormBuilder.fromJSON(json)
      expect(schema.fields[0].name).toBe('email')
    })
  })

  describe('multi-step forms', () => {
    test('configures steps', () => {
      builder.addField({ name: 'name', type: 'text', label: 'Name' })
      builder.addField({ name: 'email', type: 'email', label: 'Email' })
      builder.addField({ name: 'address', type: 'text', label: 'Address' })

      builder.setSteps([
        { title: 'Personal', fields: ['name', 'email'] },
        { title: 'Contact', fields: ['address'] },
      ])

      const schema = builder.build()
      expect(schema.steps).toHaveLength(2)
      expect(schema.steps![0].title).toBe('Personal')
    })

    test('validates step field references', () => {
      builder.addField({ name: 'name', type: 'text', label: 'Name' })

      expect(() =>
        builder.setSteps([{ title: 'Step 1', fields: ['nonexistent'] }])
      ).toThrow('Field "nonexistent" not found')
    })
  })
})

// ============================================================================
// FormValidator Tests
// ============================================================================

describe('FormValidator', () => {
  let validator: FormValidator

  const createSchema = (fields: FormField[]): FormSchema => ({
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    fields,
    layout: { columns: 1 },
  })

  describe('required field validation', () => {
    test('fails when required field is empty', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'required', message: 'Email is required' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ email: '' })

      expect(result.valid).toBe(false)
      expect(result.errors.email).toBe('Email is required')
    })

    test('fails when required field is null', () => {
      const schema = createSchema([
        {
          name: 'name',
          type: 'text',
          label: 'Name',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ name: null })

      expect(result.valid).toBe(false)
    })

    test('fails when required field is undefined', () => {
      const schema = createSchema([
        {
          name: 'name',
          type: 'text',
          label: 'Name',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({})

      expect(result.valid).toBe(false)
    })

    test('passes when required field has value', () => {
      const schema = createSchema([
        {
          name: 'name',
          type: 'text',
          label: 'Name',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ name: 'John' })

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual({})
    })
  })

  describe('pattern validation', () => {
    test('fails when email pattern does not match', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [
            {
              type: 'pattern',
              pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
              message: 'Invalid email',
            },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ email: 'not-an-email' })

      expect(result.valid).toBe(false)
      expect(result.errors.email).toBe('Invalid email')
    })

    test('passes when email pattern matches', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [
            {
              type: 'pattern',
              pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
              message: 'Invalid email',
            },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ email: 'test@example.com' })

      expect(result.valid).toBe(true)
    })

    test('validates phone number pattern', () => {
      const schema = createSchema([
        {
          name: 'phone',
          type: 'text',
          label: 'Phone',
          validation: [
            {
              type: 'pattern',
              pattern: '^\\d{3}-\\d{3}-\\d{4}$',
              message: 'Format: XXX-XXX-XXXX',
            },
          ],
        },
      ])

      validator = new FormValidator(schema)

      expect(validator.validate({ phone: '123-456-7890' }).valid).toBe(true)
      expect(validator.validate({ phone: '1234567890' }).valid).toBe(false)
    })
  })

  describe('min/max validation', () => {
    test('fails when number is below minimum', () => {
      const schema = createSchema([
        {
          name: 'age',
          type: 'number',
          label: 'Age',
          validation: [
            { type: 'min', value: 18, message: 'Must be at least 18' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ age: 16 })

      expect(result.valid).toBe(false)
      expect(result.errors.age).toBe('Must be at least 18')
    })

    test('fails when number is above maximum', () => {
      const schema = createSchema([
        {
          name: 'age',
          type: 'number',
          label: 'Age',
          validation: [{ type: 'max', value: 120, message: 'Invalid age' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ age: 150 })

      expect(result.valid).toBe(false)
    })

    test('passes when number is within range', () => {
      const schema = createSchema([
        {
          name: 'age',
          type: 'number',
          label: 'Age',
          validation: [
            { type: 'min', value: 18, message: 'Min 18' },
            { type: 'max', value: 120, message: 'Max 120' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ age: 25 })

      expect(result.valid).toBe(true)
    })
  })

  describe('string length validation', () => {
    test('fails when string is too short', () => {
      const schema = createSchema([
        {
          name: 'password',
          type: 'text',
          label: 'Password',
          validation: [
            { type: 'minLength', value: 8, message: 'Minimum 8 characters' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ password: 'short' })

      expect(result.valid).toBe(false)
      expect(result.errors.password).toBe('Minimum 8 characters')
    })

    test('fails when string is too long', () => {
      const schema = createSchema([
        {
          name: 'bio',
          type: 'textarea',
          label: 'Bio',
          validation: [
            { type: 'maxLength', value: 10, message: 'Maximum 10 characters' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ bio: 'This is way too long' })

      expect(result.valid).toBe(false)
    })

    test('passes when string length is within range', () => {
      const schema = createSchema([
        {
          name: 'username',
          type: 'text',
          label: 'Username',
          validation: [
            { type: 'minLength', value: 3, message: 'Min 3' },
            { type: 'maxLength', value: 20, message: 'Max 20' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ username: 'johndoe' })

      expect(result.valid).toBe(true)
    })
  })

  describe('custom validation functions', () => {
    test('runs custom validator and fails', () => {
      const schema = createSchema([
        {
          name: 'username',
          type: 'text',
          label: 'Username',
          validation: [
            {
              type: 'custom',
              validator: (value: unknown) => {
                if (
                  typeof value === 'string' &&
                  value.toLowerCase() === 'admin'
                ) {
                  return 'Username cannot be admin'
                }
                return null
              },
            },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ username: 'admin' })

      expect(result.valid).toBe(false)
      expect(result.errors.username).toBe('Username cannot be admin')
    })

    test('runs custom validator and passes', () => {
      const schema = createSchema([
        {
          name: 'code',
          type: 'text',
          label: 'Code',
          validation: [
            {
              type: 'custom',
              validator: (value: unknown) => {
                if (typeof value !== 'string' || !value.startsWith('CODE-')) {
                  return 'Must start with CODE-'
                }
                return null
              },
            },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ code: 'CODE-123' })

      expect(result.valid).toBe(true)
    })
  })

  describe('multiple validation rules', () => {
    test('returns first error for field', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [
            { type: 'required', message: 'Email is required' },
            { type: 'pattern', pattern: '^.+@.+$', message: 'Invalid email' },
          ],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({ email: '' })

      expect(result.errors.email).toBe('Email is required')
    })

    test('validates all fields', () => {
      const schema = createSchema([
        {
          name: 'name',
          type: 'text',
          label: 'Name',
          validation: [{ type: 'required', message: 'Name required' }],
        },
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'required', message: 'Email required' }],
        },
      ])

      validator = new FormValidator(schema)
      const result = validator.validate({})

      expect(result.errors.name).toBe('Name required')
      expect(result.errors.email).toBe('Email required')
    })
  })

  describe('validateField', () => {
    test('validates single field', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      validator = new FormValidator(schema)
      const error = validator.validateField('email', '')

      expect(error).toBe('Required')
    })

    test('returns null for valid field', () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      validator = new FormValidator(schema)
      const error = validator.validateField('email', 'test@example.com')

      expect(error).toBeNull()
    })
  })
})

// ============================================================================
// ConditionalRenderer Tests
// ============================================================================

describe('ConditionalRenderer', () => {
  let renderer: ConditionalRenderer

  beforeEach(() => {
    renderer = new ConditionalRenderer()
  })

  describe('showIf conditions', () => {
    test('shows field when condition is true', () => {
      const field: FormField = {
        name: 'company',
        type: 'text',
        label: 'Company',
        conditionalLogic: {
          showIf: { field: 'employed', equals: true },
        },
      }

      const data = { employed: true }
      expect(renderer.isVisible(field, data)).toBe(true)
    })

    test('hides field when condition is false', () => {
      const field: FormField = {
        name: 'company',
        type: 'text',
        label: 'Company',
        conditionalLogic: {
          showIf: { field: 'employed', equals: true },
        },
      }

      const data = { employed: false }
      expect(renderer.isVisible(field, data)).toBe(false)
    })

    test('shows field when no conditions defined', () => {
      const field: FormField = {
        name: 'name',
        type: 'text',
        label: 'Name',
      }

      expect(renderer.isVisible(field, {})).toBe(true)
    })
  })

  describe('hideIf conditions', () => {
    test('hides field when condition is true', () => {
      const field: FormField = {
        name: 'details',
        type: 'textarea',
        label: 'Details',
        conditionalLogic: {
          hideIf: { field: 'skip', equals: true },
        },
      }

      const data = { skip: true }
      expect(renderer.isVisible(field, data)).toBe(false)
    })

    test('shows field when hideIf condition is false', () => {
      const field: FormField = {
        name: 'details',
        type: 'textarea',
        label: 'Details',
        conditionalLogic: {
          hideIf: { field: 'skip', equals: true },
        },
      }

      const data = { skip: false }
      expect(renderer.isVisible(field, data)).toBe(true)
    })
  })

  describe('enableIf conditions', () => {
    test('enables field when condition is true', () => {
      const field: FormField = {
        name: 'frequency',
        type: 'select',
        label: 'Frequency',
        conditionalLogic: {
          enableIf: { field: 'subscribe', equals: true },
        },
      }

      const data = { subscribe: true }
      expect(renderer.isEnabled(field, data)).toBe(true)
    })

    test('disables field when condition is false', () => {
      const field: FormField = {
        name: 'frequency',
        type: 'select',
        label: 'Frequency',
        conditionalLogic: {
          enableIf: { field: 'subscribe', equals: true },
        },
      }

      const data = { subscribe: false }
      expect(renderer.isEnabled(field, data)).toBe(false)
    })
  })

  describe('complex AND conditions', () => {
    test('shows field when all AND conditions are true', () => {
      const field: FormField = {
        name: 'premium',
        type: 'text',
        label: 'Premium',
        conditionalLogic: {
          showIf: {
            and: [
              { field: 'plan', equals: 'premium' },
              { field: 'verified', equals: true },
            ],
          },
        },
      }

      const data = { plan: 'premium', verified: true }
      expect(renderer.isVisible(field, data)).toBe(true)
    })

    test('hides field when any AND condition is false', () => {
      const field: FormField = {
        name: 'premium',
        type: 'text',
        label: 'Premium',
        conditionalLogic: {
          showIf: {
            and: [
              { field: 'plan', equals: 'premium' },
              { field: 'verified', equals: true },
            ],
          },
        },
      }

      const data = { plan: 'premium', verified: false }
      expect(renderer.isVisible(field, data)).toBe(false)
    })
  })

  describe('complex OR conditions', () => {
    test('shows field when any OR condition is true', () => {
      const field: FormField = {
        name: 'discount',
        type: 'text',
        label: 'Discount',
        conditionalLogic: {
          showIf: {
            or: [
              { field: 'isStudent', equals: true },
              { field: 'isSenior', equals: true },
            ],
          },
        },
      }

      const data = { isStudent: true, isSenior: false }
      expect(renderer.isVisible(field, data)).toBe(true)
    })

    test('hides field when all OR conditions are false', () => {
      const field: FormField = {
        name: 'discount',
        type: 'text',
        label: 'Discount',
        conditionalLogic: {
          showIf: {
            or: [
              { field: 'isStudent', equals: true },
              { field: 'isSenior', equals: true },
            ],
          },
        },
      }

      const data = { isStudent: false, isSenior: false }
      expect(renderer.isVisible(field, data)).toBe(false)
    })
  })

  describe('comparison operators', () => {
    test('evaluates notEquals condition', () => {
      const field: FormField = {
        name: 'upgrade',
        type: 'text',
        label: 'Upgrade',
        conditionalLogic: {
          showIf: { field: 'plan', notEquals: 'enterprise' },
        },
      }

      expect(renderer.isVisible(field, { plan: 'basic' })).toBe(true)
      expect(renderer.isVisible(field, { plan: 'enterprise' })).toBe(false)
    })

    test('evaluates greaterThan condition', () => {
      const field: FormField = {
        name: 'bulkDiscount',
        type: 'text',
        label: 'Bulk Discount',
        conditionalLogic: {
          showIf: { field: 'quantity', greaterThan: 10 },
        },
      }

      expect(renderer.isVisible(field, { quantity: 15 })).toBe(true)
      expect(renderer.isVisible(field, { quantity: 5 })).toBe(false)
    })

    test('evaluates lessThan condition', () => {
      const field: FormField = {
        name: 'warning',
        type: 'text',
        label: 'Warning',
        conditionalLogic: {
          showIf: { field: 'stock', lessThan: 10 },
        },
      }

      expect(renderer.isVisible(field, { stock: 5 })).toBe(true)
      expect(renderer.isVisible(field, { stock: 15 })).toBe(false)
    })

    test('evaluates contains condition', () => {
      const field: FormField = {
        name: 'referral',
        type: 'text',
        label: 'Referral',
        conditionalLogic: {
          showIf: { field: 'source', contains: 'partner' },
        },
      }

      expect(renderer.isVisible(field, { source: 'partner-abc' })).toBe(true)
      expect(renderer.isVisible(field, { source: 'direct' })).toBe(false)
    })
  })

  describe('getVisibleFields', () => {
    test('returns only visible fields', () => {
      const fields: FormField[] = [
        { name: 'employed', type: 'checkbox', label: 'Employed?' },
        {
          name: 'company',
          type: 'text',
          label: 'Company',
          conditionalLogic: { showIf: { field: 'employed', equals: true } },
        },
        { name: 'email', type: 'email', label: 'Email' },
      ]

      const data = { employed: false }
      const visible = renderer.getVisibleFields(fields, data)

      expect(visible.map((f) => f.name)).toEqual(['employed', 'email'])
    })
  })
})

// ============================================================================
// FormSubmissionHandler Tests
// ============================================================================

describe('FormSubmissionHandler', () => {
  let handler: FormSubmissionHandler

  const createSchema = (fields: FormField[]): FormSchema => ({
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    fields,
    layout: { columns: 1 },
  })

  beforeEach(() => {
    handler = new FormSubmissionHandler()
  })

  describe('submission processing', () => {
    test('creates submission with metadata', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      const submission = await handler.submit(schema, { email: 'test@test.com' })

      expect(submission.id).toBeDefined()
      expect(submission.formId).toBe('test')
      expect(submission.data.email).toBe('test@test.com')
      expect(submission.timestamp).toBeInstanceOf(Date)
      expect(submission.metadata).toBeDefined()
    })

    test('validates submission before processing', async () => {
      const schema = createSchema([
        {
          name: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'required', message: 'Required' }],
        },
      ])

      await expect(handler.submit(schema, { email: '' })).rejects.toThrow(
        'Validation failed'
      )
    })

    test('sanitizes input data', async () => {
      const schema = createSchema([
        { name: 'name', type: 'text', label: 'Name' },
      ])

      const submission = await handler.submit(schema, {
        name: '  John Doe  ',
        extraField: 'should be stripped',
      })

      expect(submission.data.name).toBe('John Doe')
      expect(submission.data.extraField).toBeUndefined()
    })

    test('includes IP and user agent in metadata', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      const submission = await handler.submit(
        schema,
        { email: 'test@test.com' },
        {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        }
      )

      expect(submission.metadata?.ip).toBe('192.168.1.1')
      expect(submission.metadata?.userAgent).toBe('Mozilla/5.0')
    })
  })

  describe('submission hooks', () => {
    test('calls onBeforeSubmit hook', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      const beforeHook = vi.fn().mockResolvedValue({ email: 'modified@test.com' })
      handler.onBeforeSubmit(beforeHook)

      const submission = await handler.submit(schema, { email: 'test@test.com' })

      expect(beforeHook).toHaveBeenCalled()
      expect(submission.data.email).toBe('modified@test.com')
    })

    test('calls onAfterSubmit hook', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      const afterHook = vi.fn()
      handler.onAfterSubmit(afterHook)

      await handler.submit(schema, { email: 'test@test.com' })

      expect(afterHook).toHaveBeenCalled()
    })

    test('onBeforeSubmit can reject submission', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      handler.onBeforeSubmit(async () => {
        throw new Error('Spam detected')
      })

      await expect(handler.submit(schema, { email: 'spam@spam.com' })).rejects.toThrow(
        'Spam detected'
      )
    })
  })

  describe('submission retrieval', () => {
    test('stores and retrieves submission by id', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      const submission = await handler.submit(schema, { email: 'test@test.com' })
      const retrieved = await handler.getSubmission(submission.id)

      expect(retrieved).toEqual(submission)
    })

    test('lists submissions for form', async () => {
      const schema = createSchema([
        { name: 'email', type: 'email', label: 'Email' },
      ])

      await handler.submit(schema, { email: 'test1@test.com' })
      await handler.submit(schema, { email: 'test2@test.com' })

      const submissions = await handler.listSubmissions('test')

      expect(submissions).toHaveLength(2)
    })
  })
})

// ============================================================================
// FileUploadHandler Tests
// ============================================================================

describe('FileUploadHandler', () => {
  let handler: FileUploadHandler

  beforeEach(() => {
    handler = new FileUploadHandler({
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    })
  })

  describe('file validation', () => {
    test('rejects file exceeding max size', async () => {
      const file = {
        name: 'large.pdf',
        type: 'application/pdf',
        size: 10 * 1024 * 1024, // 10MB
        data: new Uint8Array(10 * 1024 * 1024),
      }

      await expect(handler.upload(file)).rejects.toThrow(
        'File size exceeds maximum'
      )
    })

    test('rejects file with disallowed type', async () => {
      const file = {
        name: 'script.js',
        type: 'application/javascript',
        size: 1024,
        data: new Uint8Array(1024),
      }

      await expect(handler.upload(file)).rejects.toThrow(
        'File type not allowed'
      )
    })

    test('accepts valid file', async () => {
      const file = {
        name: 'document.pdf',
        type: 'application/pdf',
        size: 1024,
        data: new Uint8Array(1024),
      }

      const result = await handler.upload(file)

      expect(result.success).toBe(true)
      expect(result.id).toBeDefined()
      expect(result.url).toBeDefined()
    })
  })

  describe('file processing', () => {
    test('generates unique file id', async () => {
      const file1 = {
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }
      const file2 = {
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }

      const result1 = await handler.upload(file1)
      const result2 = await handler.upload(file2)

      expect(result1.id).not.toBe(result2.id)
    })

    test('sanitizes filename', async () => {
      const file = {
        name: '../../../etc/passwd.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }

      const result = await handler.upload(file)

      expect(result.filename).not.toContain('..')
      expect(result.filename).not.toContain('/')
    })

    test('preserves file extension', async () => {
      const file = {
        name: 'document.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }

      const result = await handler.upload(file)

      expect(result.filename).toMatch(/\.pdf$/)
    })
  })

  describe('multiple file upload', () => {
    test('uploads multiple files', async () => {
      const files = [
        { name: 'a.pdf', type: 'application/pdf', size: 100, data: new Uint8Array(100) },
        { name: 'b.pdf', type: 'application/pdf', size: 100, data: new Uint8Array(100) },
      ]

      const results = await handler.uploadMultiple(files)

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.success)).toBe(true)
    })

    test('returns partial results on some failures', async () => {
      const files = [
        { name: 'valid.pdf', type: 'application/pdf', size: 100, data: new Uint8Array(100) },
        { name: 'invalid.js', type: 'application/javascript', size: 100, data: new Uint8Array(100) },
      ]

      const results = await handler.uploadMultiple(files)

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
    })
  })

  describe('file retrieval', () => {
    test('retrieves uploaded file', async () => {
      const file = {
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }

      const uploadResult = await handler.upload(file)
      const retrieved = await handler.getFile(uploadResult.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('doc.pdf')
    })

    test('deletes uploaded file', async () => {
      const file = {
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 100,
        data: new Uint8Array(100),
      }

      const uploadResult = await handler.upload(file)
      await handler.delete(uploadResult.id)

      const retrieved = await handler.getFile(uploadResult.id)
      expect(retrieved).toBeUndefined()
    })
  })
})

// ============================================================================
// FormVersioning Tests
// ============================================================================

describe('FormVersioning', () => {
  let versioning: FormVersioning

  const createSchema = (version: string, fields: FormField[]): FormSchema => ({
    id: 'test',
    name: 'Test',
    version,
    fields,
    layout: { columns: 1 },
  })

  beforeEach(() => {
    versioning = new FormVersioning()
  })

  describe('version management', () => {
    test('saves schema version', async () => {
      const schema = createSchema('1.0.0', [
        { name: 'email', type: 'email', label: 'Email' },
      ])

      await versioning.saveVersion(schema)
      const versions = await versioning.listVersions('test')

      expect(versions).toContain('1.0.0')
    })

    test('retrieves specific version', async () => {
      const v1 = createSchema('1.0.0', [
        { name: 'email', type: 'email', label: 'Email' },
      ])
      const v2 = createSchema('2.0.0', [
        { name: 'email', type: 'email', label: 'Email' },
        { name: 'phone', type: 'text', label: 'Phone' },
      ])

      await versioning.saveVersion(v1)
      await versioning.saveVersion(v2)

      const retrieved = await versioning.getVersion('test', '1.0.0')

      expect(retrieved?.fields).toHaveLength(1)
    })

    test('gets latest version', async () => {
      const v1 = createSchema('1.0.0', [
        { name: 'email', type: 'email', label: 'Email' },
      ])
      const v2 = createSchema('1.1.0', [
        { name: 'email', type: 'email', label: 'Email' },
        { name: 'name', type: 'text', label: 'Name' },
      ])

      await versioning.saveVersion(v1)
      await versioning.saveVersion(v2)

      const latest = await versioning.getLatestVersion('test')

      expect(latest?.version).toBe('1.1.0')
    })
  })

  describe('version comparison', () => {
    test('computes diff between versions', async () => {
      const v1 = createSchema('1.0.0', [
        { name: 'email', type: 'email', label: 'Email' },
        { name: 'phone', type: 'text', label: 'Phone' },
      ])
      const v2 = createSchema('2.0.0', [
        { name: 'email', type: 'email', label: 'Email Address' },
        { name: 'address', type: 'text', label: 'Address' },
      ])

      await versioning.saveVersion(v1)
      await versioning.saveVersion(v2)

      const diff = await versioning.diff('test', '1.0.0', '2.0.0')

      expect(diff.added).toContain('address')
      expect(diff.removed).toContain('phone')
      expect(diff.modified).toContain('email')
    })
  })

  describe('migration', () => {
    test('migrates data from old to new schema', async () => {
      const v1 = createSchema('1.0.0', [
        { name: 'fullName', type: 'text', label: 'Full Name' },
      ])
      const v2 = createSchema('2.0.0', [
        { name: 'firstName', type: 'text', label: 'First Name' },
        { name: 'lastName', type: 'text', label: 'Last Name' },
      ])

      await versioning.saveVersion(v1)
      await versioning.saveVersion(v2)

      versioning.registerMigration('test', '1.0.0', '2.0.0', (data) => {
        const [firstName, ...lastParts] = (data.fullName as string).split(' ')
        return {
          firstName,
          lastName: lastParts.join(' '),
        }
      })

      const migrated = await versioning.migrateData(
        'test',
        '1.0.0',
        '2.0.0',
        { fullName: 'John Doe' }
      )

      expect(migrated.firstName).toBe('John')
      expect(migrated.lastName).toBe('Doe')
    })

    test('throws error when migration not registered', async () => {
      await expect(
        versioning.migrateData('test', '1.0.0', '2.0.0', {})
      ).rejects.toThrow('No migration registered')
    })
  })
})

// ============================================================================
// FormAnalytics Tests
// ============================================================================

describe('FormAnalytics', () => {
  let analytics: FormAnalytics

  beforeEach(() => {
    analytics = new FormAnalytics()
  })

  describe('event tracking', () => {
    test('tracks form view', () => {
      analytics.trackView('form-1', { userId: 'user-1' })
      const stats = analytics.getStats('form-1')

      expect(stats.views).toBe(1)
    })

    test('tracks form start', () => {
      analytics.trackStart('form-1', { userId: 'user-1' })
      const stats = analytics.getStats('form-1')

      expect(stats.starts).toBe(1)
    })

    test('tracks field interaction', () => {
      analytics.trackFieldInteraction('form-1', 'email', { userId: 'user-1' })
      const fieldStats = analytics.getFieldStats('form-1', 'email')

      expect(fieldStats.interactions).toBe(1)
    })

    test('tracks form completion', () => {
      analytics.trackCompletion('form-1', { userId: 'user-1', duration: 30000 })
      const stats = analytics.getStats('form-1')

      expect(stats.completions).toBe(1)
    })

    test('tracks form abandonment', () => {
      analytics.trackAbandonment('form-1', {
        userId: 'user-1',
        lastField: 'address',
      })
      const stats = analytics.getStats('form-1')

      expect(stats.abandonments).toBe(1)
    })
  })

  describe('completion rate calculation', () => {
    test('calculates completion rate', () => {
      analytics.trackStart('form-1', { userId: 'user-1' })
      analytics.trackStart('form-1', { userId: 'user-2' })
      analytics.trackStart('form-1', { userId: 'user-3' })
      analytics.trackStart('form-1', { userId: 'user-4' })
      analytics.trackCompletion('form-1', { userId: 'user-1', duration: 10000 })
      analytics.trackCompletion('form-1', { userId: 'user-2', duration: 15000 })

      const rate = analytics.getCompletionRate('form-1')

      expect(rate).toBe(0.5) // 2/4 = 50%
    })

    test('returns 0 when no starts', () => {
      const rate = analytics.getCompletionRate('empty-form')
      expect(rate).toBe(0)
    })
  })

  describe('drop-off analysis', () => {
    test('identifies drop-off points', () => {
      // Simulate users dropping off at different points
      analytics.trackFieldInteraction('form-1', 'name', { userId: 'user-1' })
      analytics.trackFieldInteraction('form-1', 'name', { userId: 'user-2' })
      analytics.trackFieldInteraction('form-1', 'name', { userId: 'user-3' })
      analytics.trackFieldInteraction('form-1', 'email', { userId: 'user-1' })
      analytics.trackFieldInteraction('form-1', 'email', { userId: 'user-2' })
      analytics.trackFieldInteraction('form-1', 'address', { userId: 'user-1' })
      analytics.trackAbandonment('form-1', { userId: 'user-2', lastField: 'email' })
      analytics.trackAbandonment('form-1', { userId: 'user-3', lastField: 'name' })

      const dropOffs = analytics.getDropOffPoints('form-1')

      expect(dropOffs).toContainEqual(
        expect.objectContaining({ field: 'email', count: 1 })
      )
      expect(dropOffs).toContainEqual(
        expect.objectContaining({ field: 'name', count: 1 })
      )
    })
  })

  describe('average completion time', () => {
    test('calculates average completion time', () => {
      analytics.trackCompletion('form-1', { userId: 'user-1', duration: 10000 })
      analytics.trackCompletion('form-1', { userId: 'user-2', duration: 20000 })
      analytics.trackCompletion('form-1', { userId: 'user-3', duration: 30000 })

      const avgTime = analytics.getAverageCompletionTime('form-1')

      expect(avgTime).toBe(20000) // (10000 + 20000 + 30000) / 3
    })
  })

  describe('field error tracking', () => {
    test('tracks field validation errors', () => {
      analytics.trackFieldError('form-1', 'email', 'Invalid email')
      analytics.trackFieldError('form-1', 'email', 'Invalid email')
      analytics.trackFieldError('form-1', 'phone', 'Invalid format')

      const errorStats = analytics.getFieldErrorStats('form-1')

      expect(errorStats.email).toBe(2)
      expect(errorStats.phone).toBe(1)
    })
  })

  describe('time-based analysis', () => {
    test('gets stats for date range', () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      analytics.trackView('form-1', { userId: 'user-1', timestamp: yesterday })
      analytics.trackView('form-1', { userId: 'user-2', timestamp: now })

      const stats = analytics.getStatsForDateRange(
        'form-1',
        yesterday,
        now
      )

      expect(stats.views).toBe(2)
    })
  })
})
