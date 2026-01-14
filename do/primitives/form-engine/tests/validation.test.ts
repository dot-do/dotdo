/**
 * Field Validation Tests (RED Phase)
 *
 * Tests for form field validation including required, patterns, custom validators, and async validation
 */

import { describe, it, expect, vi } from 'vitest'
import { FormValidator, createValidator, validate } from '../validation'
import { createFormSchema } from '../schema'
import type { FormSchema, FormData, ValidationRule, FieldError } from '../types'

describe('FormValidator', () => {
  describe('Required Field Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true },
        { id: 'email', type: 'email', label: 'Email', required: true },
        { id: 'phone', type: 'phone', label: 'Phone', required: false },
      ],
    })

    it('should pass when all required fields are filled', () => {
      const data = { name: 'John', email: 'john@example.com' }
      const result = validate(schema, data)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail when required field is missing', () => {
      const data = { name: 'John' }
      const result = validate(schema, data)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'email' && e.rule === 'required')).toBe(true)
    })

    it('should fail when required field is empty string', () => {
      const data = { name: '', email: 'john@example.com' }
      const result = validate(schema, data)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'name' && e.rule === 'required')).toBe(true)
    })

    it('should fail when required field is null', () => {
      const data = { name: null, email: 'john@example.com' }
      const result = validate(schema, data)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'name' && e.rule === 'required')).toBe(true)
    })

    it('should fail when required field is undefined', () => {
      const data = { name: undefined, email: 'john@example.com' }
      const result = validate(schema, data)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'name' && e.rule === 'required')).toBe(true)
    })

    it('should pass when optional field is missing', () => {
      const data = { name: 'John', email: 'john@example.com' }
      const result = validate(schema, data)

      expect(result.valid).toBe(true)
    })

    it('should treat 0 as a valid value for required fields', () => {
      const numberSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [{ id: 'age', type: 'number', label: 'Age', required: true }],
      })
      const data = { age: 0 }
      const result = validate(numberSchema, data)

      expect(result.valid).toBe(true)
    })

    it('should treat false as a valid value for required checkbox', () => {
      const checkboxSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [{ id: 'agree', type: 'checkbox', label: 'Agree', required: true }],
      })
      const data = { agree: false }
      const result = validate(checkboxSchema, data)

      // Note: for checkboxes, required typically means "must be checked"
      expect(result.valid).toBe(false)
    })
  })

  describe('String Length Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'username',
          type: 'text',
          label: 'Username',
          validation: [
            { type: 'minLength', value: 3 },
            { type: 'maxLength', value: 20 },
          ],
        },
      ],
    })

    it('should pass when length is within bounds', () => {
      const result = validate(schema, { username: 'john' })
      expect(result.valid).toBe(true)
    })

    it('should fail when string is too short', () => {
      const result = validate(schema, { username: 'ab' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.rule === 'minLength')).toBe(true)
    })

    it('should fail when string is too long', () => {
      const result = validate(schema, { username: 'a'.repeat(21) })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.rule === 'maxLength')).toBe(true)
    })

    it('should handle exact minimum length', () => {
      const result = validate(schema, { username: 'abc' })
      expect(result.valid).toBe(true)
    })

    it('should handle exact maximum length', () => {
      const result = validate(schema, { username: 'a'.repeat(20) })
      expect(result.valid).toBe(true)
    })
  })

  describe('Number Range Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'age',
          type: 'number',
          label: 'Age',
          validation: [
            { type: 'min', value: 0 },
            { type: 'max', value: 120 },
          ],
        },
      ],
    })

    it('should pass when number is within range', () => {
      const result = validate(schema, { age: 25 })
      expect(result.valid).toBe(true)
    })

    it('should fail when number is below minimum', () => {
      const result = validate(schema, { age: -1 })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.rule === 'min')).toBe(true)
    })

    it('should fail when number is above maximum', () => {
      const result = validate(schema, { age: 121 })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.rule === 'max')).toBe(true)
    })

    it('should handle exact minimum value', () => {
      const result = validate(schema, { age: 0 })
      expect(result.valid).toBe(true)
    })

    it('should handle exact maximum value', () => {
      const result = validate(schema, { age: 120 })
      expect(result.valid).toBe(true)
    })

    it('should validate integer type', () => {
      const intSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'count',
            type: 'number',
            label: 'Count',
            validation: [{ type: 'integer' }],
          },
        ],
      })

      expect(validate(intSchema, { count: 5 }).valid).toBe(true)
      expect(validate(intSchema, { count: 5.5 }).valid).toBe(false)
    })

    it('should validate decimal type', () => {
      const decimalSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'price',
            type: 'number',
            label: 'Price',
            validation: [{ type: 'decimal', value: 2 }], // 2 decimal places
          },
        ],
      })

      expect(validate(decimalSchema, { price: 19.99 }).valid).toBe(true)
      expect(validate(decimalSchema, { price: 19.999 }).valid).toBe(false)
    })
  })

  describe('Pattern Validation', () => {
    it('should validate regex patterns', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'zipcode',
            type: 'text',
            label: 'ZIP Code',
            validation: [{ type: 'pattern', value: '^\\d{5}(-\\d{4})?$' }],
          },
        ],
      })

      expect(validate(schema, { zipcode: '12345' }).valid).toBe(true)
      expect(validate(schema, { zipcode: '12345-6789' }).valid).toBe(true)
      expect(validate(schema, { zipcode: 'invalid' }).valid).toBe(false)
    })

    it('should support custom error messages for patterns', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'code',
            type: 'text',
            label: 'Code',
            validation: [
              {
                type: 'pattern',
                value: '^[A-Z]{3}$',
                message: 'Code must be exactly 3 uppercase letters',
              },
            ],
          },
        ],
      })

      const result = validate(schema, { code: 'abc' })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('Code must be exactly 3 uppercase letters')
    })
  })

  describe('Email Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'email',
          type: 'email',
          label: 'Email',
          validation: [{ type: 'email' }],
        },
      ],
    })

    it('should accept valid email addresses', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.org',
        'user+tag@example.co.uk',
        'user123@test.io',
      ]

      for (const email of validEmails) {
        expect(validate(schema, { email }).valid).toBe(true)
      }
    })

    it('should reject invalid email addresses', () => {
      const invalidEmails = ['invalid', 'no@domain', '@nodomain.com', 'spaces in@email.com', 'missing.at.sign']

      for (const email of invalidEmails) {
        expect(validate(schema, { email }).valid).toBe(false)
      }
    })
  })

  describe('URL Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'website',
          type: 'url',
          label: 'Website',
          validation: [{ type: 'url' }],
        },
      ],
    })

    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://example.com/path',
        'https://sub.domain.com/path?query=value',
        'http://localhost:3000',
      ]

      for (const website of validUrls) {
        expect(validate(schema, { website }).valid).toBe(true)
      }
    })

    it('should reject invalid URLs', () => {
      const invalidUrls = ['not-a-url', 'ftp://example.com', 'example.com', 'http:/example.com']

      for (const website of invalidUrls) {
        expect(validate(schema, { website }).valid).toBe(false)
      }
    })
  })

  describe('Phone Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'phone',
          type: 'phone',
          label: 'Phone',
          validation: [{ type: 'phone' }],
        },
      ],
    })

    it('should accept valid phone numbers', () => {
      const validPhones = ['+1-555-555-5555', '555-555-5555', '(555) 555-5555', '+44 20 7946 0958']

      for (const phone of validPhones) {
        expect(validate(schema, { phone }).valid).toBe(true)
      }
    })

    it('should reject invalid phone numbers', () => {
      const invalidPhones = ['12345', 'not-a-phone', '555-555']

      for (const phone of invalidPhones) {
        expect(validate(schema, { phone }).valid).toBe(false)
      }
    })
  })

  describe('Date Validation', () => {
    const schema = createFormSchema({
      id: 'test',
      title: 'Test',
      fields: [
        {
          id: 'birthdate',
          type: 'date',
          label: 'Birthdate',
          validation: [{ type: 'date' }],
        },
      ],
    })

    it('should accept valid dates', () => {
      expect(validate(schema, { birthdate: '2000-01-01' }).valid).toBe(true)
      expect(validate(schema, { birthdate: '1990-12-31' }).valid).toBe(true)
    })

    it('should reject invalid dates', () => {
      expect(validate(schema, { birthdate: 'not-a-date' }).valid).toBe(false)
      expect(validate(schema, { birthdate: '2000-13-01' }).valid).toBe(false)
      expect(validate(schema, { birthdate: '2000-02-30' }).valid).toBe(false)
    })

    it('should validate date ranges', () => {
      const rangeSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'date',
            type: 'date',
            label: 'Date',
            min: '2020-01-01',
            max: '2030-12-31',
          },
        ],
      })

      expect(validate(rangeSchema, { date: '2025-06-15' }).valid).toBe(true)
      expect(validate(rangeSchema, { date: '2019-12-31' }).valid).toBe(false)
      expect(validate(rangeSchema, { date: '2031-01-01' }).valid).toBe(false)
    })
  })

  describe('Custom Validation Functions', () => {
    it('should support synchronous custom validators', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'password',
            type: 'text',
            label: 'Password',
            validation: [
              {
                type: 'custom',
                validate: (value: unknown) => {
                  const str = String(value)
                  return str.length >= 8 && /[A-Z]/.test(str) && /[0-9]/.test(str)
                },
                message: 'Password must be 8+ chars with uppercase and number',
              },
            ],
          },
        ],
      })

      expect(validate(schema, { password: 'ValidPass1' }).valid).toBe(true)
      expect(validate(schema, { password: 'weak' }).valid).toBe(false)
    })

    it('should receive field and context in custom validators', () => {
      const validateFn = vi.fn(() => true)

      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'field1',
            type: 'text',
            label: 'Field 1',
            validation: [{ type: 'custom', validate: validateFn }],
          },
        ],
      })

      const data = { field1: 'value' }
      validate(schema, data)

      expect(validateFn).toHaveBeenCalledWith(
        'value',
        expect.objectContaining({ id: 'field1' }),
        expect.objectContaining({ data })
      )
    })

    it('should support cross-field validation', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'password', type: 'text', label: 'Password' },
          {
            id: 'confirmPassword',
            type: 'text',
            label: 'Confirm Password',
            validation: [
              {
                type: 'custom',
                validate: (value: unknown, _field, context) => {
                  return value === context.data.password
                },
                message: 'Passwords must match',
              },
            ],
          },
        ],
      })

      expect(validate(schema, { password: 'abc123', confirmPassword: 'abc123' }).valid).toBe(true)
      expect(validate(schema, { password: 'abc123', confirmPassword: 'different' }).valid).toBe(false)
    })
  })

  describe('Async Validation', () => {
    it('should support async validators', async () => {
      const asyncCheck = vi.fn().mockResolvedValue(true)

      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'username',
            type: 'text',
            label: 'Username',
            validation: [
              {
                type: 'custom',
                async: true,
                validate: asyncCheck,
                message: 'Username is already taken',
              },
            ],
          },
        ],
      })

      const validator = createValidator(schema)
      const result = await validator.validateAsync({ username: 'john' })

      expect(result.valid).toBe(true)
      expect(asyncCheck).toHaveBeenCalled()
    })

    it('should fail when async validator returns false', async () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'email',
            type: 'email',
            label: 'Email',
            validation: [
              {
                type: 'custom',
                async: true,
                validate: async () => false,
                message: 'Email already registered',
              },
            ],
          },
        ],
      })

      const validator = createValidator(schema)
      const result = await validator.validateAsync({ email: 'test@example.com' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('Email already registered')
    })

    it('should handle async validation errors gracefully', async () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'data',
            type: 'text',
            label: 'Data',
            validation: [
              {
                type: 'custom',
                async: true,
                validate: async () => {
                  throw new Error('API error')
                },
                message: 'Validation failed',
              },
            ],
          },
        ],
      })

      const validator = createValidator(schema)
      const result = await validator.validateAsync({ data: 'test' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toContain('Validation failed')
    })

    it('should run sync validations before async', async () => {
      const asyncCheck = vi.fn().mockResolvedValue(true)

      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'email',
            type: 'email',
            label: 'Email',
            required: true,
            validation: [
              { type: 'email' },
              {
                type: 'custom',
                async: true,
                validate: asyncCheck,
              },
            ],
          },
        ],
      })

      const validator = createValidator(schema, { stopOnFirstError: true })
      const result = await validator.validateAsync({ email: '' })

      expect(result.valid).toBe(false)
      expect(result.errors[0].rule).toBe('required')
      expect(asyncCheck).not.toHaveBeenCalled() // Should not run async if sync fails (when stopOnFirstError is set)
    })
  })

  describe('Multiple Validation Rules', () => {
    it('should collect all validation errors', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'name', type: 'text', label: 'Name', required: true },
          { id: 'email', type: 'email', label: 'Email', required: true, validation: [{ type: 'email' }] },
          { id: 'age', type: 'number', label: 'Age', validation: [{ type: 'min', value: 0 }] },
        ],
      })

      const result = validate(schema, { name: '', email: 'invalid', age: -5 })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })

    it('should stop on first error with stopOnFirstError option', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'field1', type: 'text', label: 'Field 1', required: true },
          { id: 'field2', type: 'text', label: 'Field 2', required: true },
        ],
      })

      const validator = createValidator(schema, { stopOnFirstError: true })
      const result = validator.validate({ field1: '', field2: '' })

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
    })
  })

  describe('Validation Context', () => {
    it('should provide form data in validation context', () => {
      const contextCheck = vi.fn(() => true)

      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'field',
            type: 'text',
            label: 'Field',
            validation: [{ type: 'custom', validate: contextCheck }],
          },
        ],
      })

      validate(schema, { field: 'value', other: 'data' })

      const context = contextCheck.mock.calls[0][2]
      expect(context.data).toEqual({ field: 'value', other: 'data' })
    })

    it('should provide schema in validation context', () => {
      const contextCheck = vi.fn(() => true)

      const schema = createFormSchema({
        id: 'test-schema',
        title: 'Test',
        fields: [
          {
            id: 'field',
            type: 'text',
            label: 'Field',
            validation: [{ type: 'custom', validate: contextCheck }],
          },
        ],
      })

      validate(schema, { field: 'value' })

      const context = contextCheck.mock.calls[0][2]
      expect(context.schema.id).toBe('test-schema')
    })
  })

  describe('Nested Field Validation', () => {
    it('should validate fields in groups', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'address',
            type: 'group',
            label: 'Address',
            fields: [
              { id: 'street', type: 'text', label: 'Street', required: true },
              { id: 'city', type: 'text', label: 'City', required: true },
            ],
          },
        ],
      })

      const result = validate(schema, { address: { street: '123 Main', city: '' } })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'address.city')).toBe(true)
    })

    it('should validate deeply nested fields', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'person',
            type: 'group',
            label: 'Person',
            fields: [
              {
                id: 'address',
                type: 'group',
                label: 'Address',
                fields: [{ id: 'zip', type: 'text', label: 'ZIP', validation: [{ type: 'pattern', value: '^\\d{5}$' }] }],
              },
            ],
          },
        ],
      })

      const result = validate(schema, { person: { address: { zip: 'invalid' } } })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.field === 'person.address.zip')).toBe(true)
    })
  })

  describe('Conditional Validation', () => {
    it('should only validate visible fields', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'hasCompany', type: 'checkbox', label: 'Has Company' },
          {
            id: 'companyName',
            type: 'text',
            label: 'Company Name',
            required: true,
            conditions: [
              {
                when: { field: 'hasCompany', operator: 'equals', value: true },
                action: 'show',
              },
            ],
          },
        ],
      })

      // When hasCompany is false, companyName should not be validated
      const result1 = validate(schema, { hasCompany: false })
      expect(result1.valid).toBe(true)

      // When hasCompany is true, companyName should be required
      const result2 = validate(schema, { hasCompany: true })
      expect(result2.valid).toBe(false)
      expect(result2.errors.some((e) => e.field === 'companyName')).toBe(true)
    })
  })

  describe('Error Messages', () => {
    it('should use custom error messages', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'name',
            type: 'text',
            label: 'Name',
            // Note: use validation rule with message, not `required: true` field property
            // The field property uses default message, validation rules support custom messages
            validation: [{ type: 'minLength', value: 1, message: 'Please enter your name' }],
          },
        ],
      })

      const result = validate(schema, { name: '' })
      expect(result.errors[0].message).toBe('Please enter your name')
    })

    it('should use default error messages when custom not provided', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [{ id: 'email', type: 'email', label: 'Email', required: true }],
      })

      const result = validate(schema, { email: '' })
      expect(result.errors[0].message).toBeDefined()
      expect(result.errors[0].message.length).toBeGreaterThan(0)
    })

    it('should include field value in error object', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'age',
            type: 'number',
            label: 'Age',
            validation: [{ type: 'min', value: 0 }],
          },
        ],
      })

      const result = validate(schema, { age: -5 })
      expect(result.errors[0].value).toBe(-5)
    })
  })
})
