/**
 * Conditional Logic Tests (RED Phase)
 *
 * Tests for show/hide fields, skip logic, and complex condition chains
 */

import { describe, it, expect } from 'vitest'
import { ConditionalEvaluator, evaluateConditions, createConditionEvaluator } from '../conditional'
import { createFormSchema } from '../schema'
import type { Condition, ConditionGroup, ConditionalRule, FormData } from '../types'

describe('ConditionalLogic', () => {
  describe('Basic Conditions', () => {
    const evaluator = createConditionEvaluator()

    describe('equals operator', () => {
      it('should match equal string values', () => {
        const condition: Condition = { field: 'status', operator: 'equals', value: 'active' }
        expect(evaluator.evaluate(condition, { status: 'active' })).toBe(true)
        expect(evaluator.evaluate(condition, { status: 'inactive' })).toBe(false)
      })

      it('should match equal number values', () => {
        const condition: Condition = { field: 'count', operator: 'equals', value: 5 }
        expect(evaluator.evaluate(condition, { count: 5 })).toBe(true)
        expect(evaluator.evaluate(condition, { count: 10 })).toBe(false)
      })

      it('should match equal boolean values', () => {
        const condition: Condition = { field: 'active', operator: 'equals', value: true }
        expect(evaluator.evaluate(condition, { active: true })).toBe(true)
        expect(evaluator.evaluate(condition, { active: false })).toBe(false)
      })

      it('should handle null values', () => {
        const condition: Condition = { field: 'value', operator: 'equals', value: null }
        expect(evaluator.evaluate(condition, { value: null })).toBe(true)
        expect(evaluator.evaluate(condition, { value: 'something' })).toBe(false)
      })
    })

    describe('notEquals operator', () => {
      it('should match non-equal values', () => {
        const condition: Condition = { field: 'status', operator: 'notEquals', value: 'active' }
        expect(evaluator.evaluate(condition, { status: 'inactive' })).toBe(true)
        expect(evaluator.evaluate(condition, { status: 'active' })).toBe(false)
      })
    })

    describe('contains operator', () => {
      it('should match strings containing substring', () => {
        const condition: Condition = { field: 'email', operator: 'contains', value: '@example' }
        expect(evaluator.evaluate(condition, { email: 'user@example.com' })).toBe(true)
        expect(evaluator.evaluate(condition, { email: 'user@other.com' })).toBe(false)
      })

      it('should match arrays containing value', () => {
        const condition: Condition = { field: 'tags', operator: 'contains', value: 'urgent' }
        expect(evaluator.evaluate(condition, { tags: ['normal', 'urgent', 'review'] })).toBe(true)
        expect(evaluator.evaluate(condition, { tags: ['normal', 'review'] })).toBe(false)
      })
    })

    describe('notContains operator', () => {
      it('should match strings not containing substring', () => {
        const condition: Condition = { field: 'text', operator: 'notContains', value: 'spam' }
        expect(evaluator.evaluate(condition, { text: 'hello world' })).toBe(true)
        expect(evaluator.evaluate(condition, { text: 'this is spam' })).toBe(false)
      })
    })

    describe('startsWith operator', () => {
      it('should match strings starting with prefix', () => {
        const condition: Condition = { field: 'code', operator: 'startsWith', value: 'PRE-' }
        expect(evaluator.evaluate(condition, { code: 'PRE-001' })).toBe(true)
        expect(evaluator.evaluate(condition, { code: 'POST-001' })).toBe(false)
      })
    })

    describe('endsWith operator', () => {
      it('should match strings ending with suffix', () => {
        const condition: Condition = { field: 'file', operator: 'endsWith', value: '.pdf' }
        expect(evaluator.evaluate(condition, { file: 'document.pdf' })).toBe(true)
        expect(evaluator.evaluate(condition, { file: 'document.doc' })).toBe(false)
      })
    })

    describe('greaterThan operator', () => {
      it('should compare numbers', () => {
        const condition: Condition = { field: 'age', operator: 'greaterThan', value: 18 }
        expect(evaluator.evaluate(condition, { age: 21 })).toBe(true)
        expect(evaluator.evaluate(condition, { age: 18 })).toBe(false)
        expect(evaluator.evaluate(condition, { age: 15 })).toBe(false)
      })

      it('should compare dates', () => {
        const condition: Condition = { field: 'date', operator: 'greaterThan', value: '2020-01-01' }
        expect(evaluator.evaluate(condition, { date: '2021-01-01' })).toBe(true)
        expect(evaluator.evaluate(condition, { date: '2019-01-01' })).toBe(false)
      })
    })

    describe('lessThan operator', () => {
      it('should compare numbers', () => {
        const condition: Condition = { field: 'count', operator: 'lessThan', value: 10 }
        expect(evaluator.evaluate(condition, { count: 5 })).toBe(true)
        expect(evaluator.evaluate(condition, { count: 10 })).toBe(false)
        expect(evaluator.evaluate(condition, { count: 15 })).toBe(false)
      })
    })

    describe('greaterThanOrEquals operator', () => {
      it('should compare with equality', () => {
        const condition: Condition = { field: 'score', operator: 'greaterThanOrEquals', value: 70 }
        expect(evaluator.evaluate(condition, { score: 80 })).toBe(true)
        expect(evaluator.evaluate(condition, { score: 70 })).toBe(true)
        expect(evaluator.evaluate(condition, { score: 60 })).toBe(false)
      })
    })

    describe('lessThanOrEquals operator', () => {
      it('should compare with equality', () => {
        const condition: Condition = { field: 'price', operator: 'lessThanOrEquals', value: 100 }
        expect(evaluator.evaluate(condition, { price: 50 })).toBe(true)
        expect(evaluator.evaluate(condition, { price: 100 })).toBe(true)
        expect(evaluator.evaluate(condition, { price: 150 })).toBe(false)
      })
    })

    describe('isEmpty operator', () => {
      it('should match empty strings', () => {
        const condition: Condition = { field: 'name', operator: 'isEmpty' }
        expect(evaluator.evaluate(condition, { name: '' })).toBe(true)
        expect(evaluator.evaluate(condition, { name: 'John' })).toBe(false)
      })

      it('should match null/undefined', () => {
        const condition: Condition = { field: 'value', operator: 'isEmpty' }
        expect(evaluator.evaluate(condition, { value: null })).toBe(true)
        expect(evaluator.evaluate(condition, { value: undefined })).toBe(true)
        expect(evaluator.evaluate(condition, {})).toBe(true)
      })

      it('should match empty arrays', () => {
        const condition: Condition = { field: 'items', operator: 'isEmpty' }
        expect(evaluator.evaluate(condition, { items: [] })).toBe(true)
        expect(evaluator.evaluate(condition, { items: ['a'] })).toBe(false)
      })
    })

    describe('isNotEmpty operator', () => {
      it('should match non-empty values', () => {
        const condition: Condition = { field: 'name', operator: 'isNotEmpty' }
        expect(evaluator.evaluate(condition, { name: 'John' })).toBe(true)
        expect(evaluator.evaluate(condition, { name: '' })).toBe(false)
        expect(evaluator.evaluate(condition, { name: null })).toBe(false)
      })
    })

    describe('matches operator (regex)', () => {
      it('should match regex patterns', () => {
        const condition: Condition = { field: 'code', operator: 'matches', value: '^[A-Z]{3}-\\d{3}$' }
        expect(evaluator.evaluate(condition, { code: 'ABC-123' })).toBe(true)
        expect(evaluator.evaluate(condition, { code: 'ab-123' })).toBe(false)
      })
    })

    describe('in operator', () => {
      it('should match value in array', () => {
        const condition: Condition = { field: 'status', operator: 'in', value: ['active', 'pending'] }
        expect(evaluator.evaluate(condition, { status: 'active' })).toBe(true)
        expect(evaluator.evaluate(condition, { status: 'pending' })).toBe(true)
        expect(evaluator.evaluate(condition, { status: 'closed' })).toBe(false)
      })
    })

    describe('notIn operator', () => {
      it('should match value not in array', () => {
        const condition: Condition = { field: 'type', operator: 'notIn', value: ['spam', 'test'] }
        expect(evaluator.evaluate(condition, { type: 'normal' })).toBe(true)
        expect(evaluator.evaluate(condition, { type: 'spam' })).toBe(false)
      })
    })
  })

  describe('Condition Groups', () => {
    const evaluator = createConditionEvaluator()

    describe('AND logic', () => {
      it('should require all conditions to be true', () => {
        const group: ConditionGroup = {
          logic: 'and',
          conditions: [
            { field: 'age', operator: 'greaterThanOrEquals', value: 18 },
            { field: 'country', operator: 'equals', value: 'US' },
          ],
        }

        expect(evaluator.evaluateGroup(group, { age: 21, country: 'US' })).toBe(true)
        expect(evaluator.evaluateGroup(group, { age: 21, country: 'UK' })).toBe(false)
        expect(evaluator.evaluateGroup(group, { age: 15, country: 'US' })).toBe(false)
      })

      it('should return false if any condition is false', () => {
        const group: ConditionGroup = {
          logic: 'and',
          conditions: [
            { field: 'a', operator: 'equals', value: 1 },
            { field: 'b', operator: 'equals', value: 2 },
            { field: 'c', operator: 'equals', value: 3 },
          ],
        }

        expect(evaluator.evaluateGroup(group, { a: 1, b: 2, c: 3 })).toBe(true)
        expect(evaluator.evaluateGroup(group, { a: 1, b: 2, c: 999 })).toBe(false)
      })
    })

    describe('OR logic', () => {
      it('should require at least one condition to be true', () => {
        const group: ConditionGroup = {
          logic: 'or',
          conditions: [
            { field: 'role', operator: 'equals', value: 'admin' },
            { field: 'role', operator: 'equals', value: 'moderator' },
          ],
        }

        expect(evaluator.evaluateGroup(group, { role: 'admin' })).toBe(true)
        expect(evaluator.evaluateGroup(group, { role: 'moderator' })).toBe(true)
        expect(evaluator.evaluateGroup(group, { role: 'user' })).toBe(false)
      })

      it('should return true if any condition is true', () => {
        const group: ConditionGroup = {
          logic: 'or',
          conditions: [
            { field: 'a', operator: 'equals', value: 1 },
            { field: 'b', operator: 'equals', value: 2 },
          ],
        }

        expect(evaluator.evaluateGroup(group, { a: 999, b: 2 })).toBe(true)
        expect(evaluator.evaluateGroup(group, { a: 1, b: 999 })).toBe(true)
        expect(evaluator.evaluateGroup(group, { a: 999, b: 999 })).toBe(false)
      })
    })

    describe('Nested condition groups', () => {
      it('should evaluate nested AND within OR', () => {
        const group: ConditionGroup = {
          logic: 'or',
          conditions: [
            {
              logic: 'and',
              conditions: [
                { field: 'type', operator: 'equals', value: 'premium' },
                { field: 'active', operator: 'equals', value: true },
              ],
            },
            { field: 'role', operator: 'equals', value: 'admin' },
          ],
        }

        // Premium AND active
        expect(evaluator.evaluateGroup(group, { type: 'premium', active: true, role: 'user' })).toBe(true)
        // Admin (regardless of type/active)
        expect(evaluator.evaluateGroup(group, { type: 'basic', active: false, role: 'admin' })).toBe(true)
        // Neither
        expect(evaluator.evaluateGroup(group, { type: 'basic', active: false, role: 'user' })).toBe(false)
      })

      it('should evaluate nested OR within AND', () => {
        const group: ConditionGroup = {
          logic: 'and',
          conditions: [
            { field: 'verified', operator: 'equals', value: true },
            {
              logic: 'or',
              conditions: [
                { field: 'country', operator: 'equals', value: 'US' },
                { field: 'country', operator: 'equals', value: 'CA' },
              ],
            },
          ],
        }

        expect(evaluator.evaluateGroup(group, { verified: true, country: 'US' })).toBe(true)
        expect(evaluator.evaluateGroup(group, { verified: true, country: 'CA' })).toBe(true)
        expect(evaluator.evaluateGroup(group, { verified: false, country: 'US' })).toBe(false)
        expect(evaluator.evaluateGroup(group, { verified: true, country: 'UK' })).toBe(false)
      })

      it('should handle deeply nested conditions', () => {
        const group: ConditionGroup = {
          logic: 'and',
          conditions: [
            { field: 'a', operator: 'equals', value: 1 },
            {
              logic: 'or',
              conditions: [
                { field: 'b', operator: 'equals', value: 2 },
                {
                  logic: 'and',
                  conditions: [
                    { field: 'c', operator: 'equals', value: 3 },
                    { field: 'd', operator: 'equals', value: 4 },
                  ],
                },
              ],
            },
          ],
        }

        expect(evaluator.evaluateGroup(group, { a: 1, b: 2, c: 0, d: 0 })).toBe(true) // a=1 AND b=2
        expect(evaluator.evaluateGroup(group, { a: 1, b: 0, c: 3, d: 4 })).toBe(true) // a=1 AND (c=3 AND d=4)
        expect(evaluator.evaluateGroup(group, { a: 1, b: 0, c: 3, d: 0 })).toBe(false)
      })
    })
  })

  describe('Conditional Actions', () => {
    describe('show/hide actions', () => {
      it('should determine field visibility based on conditions', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'hasSpouse', type: 'checkbox', label: 'Married?' },
            {
              id: 'spouseName',
              type: 'text',
              label: 'Spouse Name',
              conditions: [
                {
                  when: { field: 'hasSpouse', operator: 'equals', value: true },
                  action: 'show',
                },
              ],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { hasSpouse: true })
        expect(result1.visibility.spouseName).toBe(true)

        const result2 = evaluateConditions(schema, { hasSpouse: false })
        expect(result2.visibility.spouseName).toBe(false)
      })

      it('should handle hide action', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'status', type: 'select', label: 'Status', options: [] },
            {
              id: 'reason',
              type: 'textarea',
              label: 'Reason',
              conditions: [
                {
                  when: { field: 'status', operator: 'equals', value: 'approved' },
                  action: 'hide',
                },
              ],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { status: 'approved' })
        expect(result1.visibility.reason).toBe(false)

        const result2 = evaluateConditions(schema, { status: 'rejected' })
        expect(result2.visibility.reason).toBe(true)
      })

      it('should target multiple fields with one rule', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'type', type: 'select', label: 'Type', options: [] },
            {
              id: 'businessName',
              type: 'text',
              label: 'Business Name',
              conditions: [
                {
                  when: { field: 'type', operator: 'equals', value: 'business' },
                  action: 'show',
                  target: ['businessName', 'taxId'],
                },
              ],
            },
            { id: 'taxId', type: 'text', label: 'Tax ID' },
          ],
        })

        const result = evaluateConditions(schema, { type: 'business' })
        expect(result.visibility.businessName).toBe(true)
        expect(result.visibility.taxId).toBe(true)
      })
    })

    describe('enable/disable actions', () => {
      it('should determine field enabled state', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'agree', type: 'checkbox', label: 'I agree' },
            {
              id: 'submit',
              type: 'hidden',
              label: 'Submit',
              conditions: [
                {
                  when: { field: 'agree', operator: 'equals', value: true },
                  action: 'enable',
                },
              ],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { agree: true })
        expect(result1.enabled.submit).toBe(true)

        const result2 = evaluateConditions(schema, { agree: false })
        expect(result2.enabled.submit).toBe(false)
      })

      it('should handle disable action', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'locked', type: 'checkbox', label: 'Lock fields' },
            {
              id: 'data',
              type: 'text',
              label: 'Data',
              conditions: [
                {
                  when: { field: 'locked', operator: 'equals', value: true },
                  action: 'disable',
                },
              ],
            },
          ],
        })

        const result = evaluateConditions(schema, { locked: true })
        expect(result.enabled.data).toBe(false)
      })
    })

    describe('require/optional actions', () => {
      it('should conditionally make fields required', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'needsContact', type: 'checkbox', label: 'Contact me' },
            {
              id: 'phone',
              type: 'phone',
              label: 'Phone',
              conditions: [
                {
                  when: { field: 'needsContact', operator: 'equals', value: true },
                  action: 'require',
                },
              ],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { needsContact: true })
        expect(result1.required.phone).toBe(true)

        const result2 = evaluateConditions(schema, { needsContact: false })
        expect(result2.required.phone).toBe(false)
      })

      it('should handle optional action', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'skipDetails', type: 'checkbox', label: 'Skip details' },
            {
              id: 'details',
              type: 'textarea',
              label: 'Details',
              required: true,
              conditions: [
                {
                  when: { field: 'skipDetails', operator: 'equals', value: true },
                  action: 'optional',
                },
              ],
            },
          ],
        })

        const result = evaluateConditions(schema, { skipDetails: true })
        expect(result.required.details).toBe(false)
      })
    })

    describe('setValue action', () => {
      it('should set field values based on conditions', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          fields: [
            { id: 'country', type: 'select', label: 'Country', options: [] },
            {
              id: 'currency',
              type: 'text',
              label: 'Currency',
              conditions: [
                {
                  when: { field: 'country', operator: 'equals', value: 'US' },
                  action: 'setValue',
                  value: 'USD',
                },
                {
                  when: { field: 'country', operator: 'equals', value: 'UK' },
                  action: 'setValue',
                  value: 'GBP',
                },
              ],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { country: 'US' })
        expect(result1.values.currency).toBe('USD')

        const result2 = evaluateConditions(schema, { country: 'UK' })
        expect(result2.values.currency).toBe('GBP')
      })
    })

    describe('skipToStep action', () => {
      it('should determine next step based on conditions', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          steps: [
            {
              id: 'step1',
              title: 'Step 1',
              fields: [{ id: 'fastTrack', type: 'checkbox', label: 'Fast Track' }],
              conditions: [
                {
                  when: { field: 'fastTrack', operator: 'equals', value: true },
                  action: 'skipToStep',
                  step: 2, // Skip to step index 2
                },
              ],
            },
            {
              id: 'step2',
              title: 'Step 2',
              fields: [{ id: 'data', type: 'text', label: 'Data' }],
            },
            {
              id: 'step3',
              title: 'Step 3',
              fields: [{ id: 'final', type: 'text', label: 'Final' }],
            },
          ],
        })

        const result1 = evaluateConditions(schema, { fastTrack: true }, { currentStep: 0 })
        expect(result1.nextStep).toBe(2)

        const result2 = evaluateConditions(schema, { fastTrack: false }, { currentStep: 0 })
        expect(result2.nextStep).toBe(1)
      })
    })

    describe('skipToEnd action', () => {
      it('should skip to end of form', () => {
        const schema = createFormSchema({
          id: 'test',
          title: 'Test',
          steps: [
            {
              id: 'step1',
              title: 'Step 1',
              fields: [{ id: 'complete', type: 'checkbox', label: 'Already Complete' }],
              conditions: [
                {
                  when: { field: 'complete', operator: 'equals', value: true },
                  action: 'skipToEnd',
                },
              ],
            },
            {
              id: 'step2',
              title: 'Step 2',
              fields: [{ id: 'data', type: 'text', label: 'Data' }],
            },
          ],
        })

        const result = evaluateConditions(schema, { complete: true }, { currentStep: 0 })
        expect(result.skipToEnd).toBe(true)
      })
    })
  })

  describe('Complex Condition Chains', () => {
    it('should handle multiple conditions on same field', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'amount', type: 'number', label: 'Amount' },
          {
            id: 'approval',
            type: 'text',
            label: 'Approval',
            conditions: [
              {
                when: { field: 'amount', operator: 'greaterThan', value: 1000 },
                action: 'show',
              },
              {
                when: { field: 'amount', operator: 'greaterThan', value: 10000 },
                action: 'require',
              },
            ],
          },
        ],
      })

      // Amount <= 1000: hidden
      const result1 = evaluateConditions(schema, { amount: 500 })
      expect(result1.visibility.approval).toBe(false)
      expect(result1.required.approval).toBe(false)

      // 1000 < Amount <= 10000: visible but optional
      const result2 = evaluateConditions(schema, { amount: 5000 })
      expect(result2.visibility.approval).toBe(true)
      expect(result2.required.approval).toBe(false)

      // Amount > 10000: visible and required
      const result3 = evaluateConditions(schema, { amount: 15000 })
      expect(result3.visibility.approval).toBe(true)
      expect(result3.required.approval).toBe(true)
    })

    it('should handle conditions across multiple fields', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'type', type: 'select', label: 'Type', options: [] },
          { id: 'priority', type: 'select', label: 'Priority', options: [] },
          {
            id: 'urgentNote',
            type: 'textarea',
            label: 'Urgent Note',
            conditions: [
              {
                when: {
                  logic: 'and',
                  conditions: [
                    { field: 'type', operator: 'equals', value: 'support' },
                    { field: 'priority', operator: 'equals', value: 'high' },
                  ],
                },
                action: 'show',
              },
            ],
          },
        ],
      })

      expect(evaluateConditions(schema, { type: 'support', priority: 'high' }).visibility.urgentNote).toBe(true)
      expect(evaluateConditions(schema, { type: 'support', priority: 'low' }).visibility.urgentNote).toBe(false)
      expect(evaluateConditions(schema, { type: 'inquiry', priority: 'high' }).visibility.urgentNote).toBe(false)
    })

    it('should handle cascading visibility', () => {
      // When field A shows field B, and field B shows field C
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          { id: 'hasAddress', type: 'checkbox', label: 'Has Address' },
          {
            id: 'addressType',
            type: 'select',
            label: 'Address Type',
            options: [
              { value: 'home', label: 'Home' },
              { value: 'business', label: 'Business' },
            ],
            conditions: [
              {
                when: { field: 'hasAddress', operator: 'equals', value: true },
                action: 'show',
              },
            ],
          },
          {
            id: 'companyName',
            type: 'text',
            label: 'Company Name',
            conditions: [
              {
                when: { field: 'addressType', operator: 'equals', value: 'business' },
                action: 'show',
              },
            ],
          },
        ],
      })

      // No address -> nothing shown
      const result1 = evaluateConditions(schema, { hasAddress: false })
      expect(result1.visibility.addressType).toBe(false)
      expect(result1.visibility.companyName).toBe(false)

      // Has address, home type -> addressType shown, companyName hidden
      const result2 = evaluateConditions(schema, { hasAddress: true, addressType: 'home' })
      expect(result2.visibility.addressType).toBe(true)
      expect(result2.visibility.companyName).toBe(false)

      // Has address, business type -> both shown
      const result3 = evaluateConditions(schema, { hasAddress: true, addressType: 'business' })
      expect(result3.visibility.addressType).toBe(true)
      expect(result3.visibility.companyName).toBe(true)
    })
  })

  describe('Step-level Conditions', () => {
    it('should determine step visibility', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        steps: [
          {
            id: 'basic',
            title: 'Basic Info',
            fields: [{ id: 'isBusiness', type: 'checkbox', label: 'Business Account' }],
          },
          {
            id: 'business',
            title: 'Business Info',
            fields: [{ id: 'companyName', type: 'text', label: 'Company' }],
            conditions: [
              {
                when: { field: 'isBusiness', operator: 'equals', value: true },
                action: 'show',
              },
            ],
          },
          {
            id: 'personal',
            title: 'Personal Info',
            fields: [{ id: 'name', type: 'text', label: 'Name' }],
          },
        ],
      })

      const result1 = evaluateConditions(schema, { isBusiness: true })
      expect(result1.stepVisibility.business).toBe(true)

      const result2 = evaluateConditions(schema, { isBusiness: false })
      expect(result2.stepVisibility.business).toBe(false)
    })

    it('should skip hidden steps in navigation', () => {
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            fields: [{ id: 'skipStep2', type: 'checkbox', label: 'Skip Step 2' }],
          },
          {
            id: 'step2',
            title: 'Step 2',
            fields: [{ id: 'data', type: 'text', label: 'Data' }],
            conditions: [
              {
                when: { field: 'skipStep2', operator: 'equals', value: true },
                action: 'hide',
              },
            ],
          },
          {
            id: 'step3',
            title: 'Step 3',
            fields: [{ id: 'final', type: 'text', label: 'Final' }],
          },
        ],
      })

      const result = evaluateConditions(schema, { skipStep2: true }, { currentStep: 0 })
      // When going next from step 0, should skip step 1 (index 1) and go to step 2 (index 2)
      expect(result.nextStep).toBe(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing field references gracefully', () => {
      const evaluator = createConditionEvaluator()
      const condition: Condition = { field: 'nonexistent', operator: 'equals', value: 'test' }

      expect(evaluator.evaluate(condition, {})).toBe(false)
    })

    it('should handle type mismatches gracefully', () => {
      const evaluator = createConditionEvaluator()
      const condition: Condition = { field: 'value', operator: 'greaterThan', value: 10 }

      expect(evaluator.evaluate(condition, { value: 'not-a-number' })).toBe(false)
    })

    it('should handle circular dependencies', () => {
      // Field A depends on B, B depends on A
      const schema = createFormSchema({
        id: 'test',
        title: 'Test',
        fields: [
          {
            id: 'a',
            type: 'text',
            label: 'A',
            conditions: [
              {
                when: { field: 'b', operator: 'equals', value: 'show' },
                action: 'show',
              },
            ],
          },
          {
            id: 'b',
            type: 'text',
            label: 'B',
            conditions: [
              {
                when: { field: 'a', operator: 'equals', value: 'show' },
                action: 'show',
              },
            ],
          },
        ],
      })

      // Should not infinite loop
      expect(() => evaluateConditions(schema, { a: 'show', b: 'show' })).not.toThrow()
    })

    it('should handle empty condition groups', () => {
      const evaluator = createConditionEvaluator()
      const group: ConditionGroup = { logic: 'and', conditions: [] }

      expect(evaluator.evaluateGroup(group, {})).toBe(true) // Empty AND is true
    })
  })
})
