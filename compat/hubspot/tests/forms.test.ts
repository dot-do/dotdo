/**
 * @dotdo/hubspot/forms - Forms API Tests
 *
 * Comprehensive tests for the HubSpot Forms API compatibility layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  HubSpotForms,
  HubSpotFormsError,
  type Form,
  type FormSubmission,
  type FormsStorage,
} from '../forms'

// =============================================================================
// Test Storage Implementation
// =============================================================================

class TestStorage implements FormsStorage {
  private data: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    for (const [key, value] of this.data) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      result.set(key, value)
    }
    return result
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// Form CRUD Tests
// =============================================================================

describe('@dotdo/hubspot/forms - Form CRUD', () => {
  let forms: HubSpotForms
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    forms = new HubSpotForms(storage)
  })

  describe('createForm', () => {
    it('should create a basic form', async () => {
      const form = await forms.createForm({
        name: 'Contact Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
            ],
          },
        ],
      })

      expect(form.id).toBeDefined()
      expect(form.name).toBe('Contact Form')
      expect(form.state).toBe('draft')
      expect(form.fieldGroups).toHaveLength(1)
      expect(form.fieldGroups[0].fields).toHaveLength(1)
    })

    it('should create a form with multiple field groups', async () => {
      const form = await forms.createForm({
        name: 'Multi-group Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [{ name: 'name', label: 'Name', fieldType: 'text', required: true, hidden: false }],
          },
          {
            groupType: 'progressive',
            fields: [{ name: 'phone', label: 'Phone', fieldType: 'phonenumber', required: false, hidden: false }],
          },
        ],
      })

      expect(form.fieldGroups).toHaveLength(2)
      expect(form.fieldGroups[0].groupType).toBe('default_group')
      expect(form.fieldGroups[1].groupType).toBe('progressive')
    })

    it('should create a form with custom styling', async () => {
      const form = await forms.createForm({
        name: 'Styled Form',
        fieldGroups: [
          { groupType: 'default_group', fields: [] },
        ],
        style: {
          fontFamily: 'Arial',
          submitColor: '#007bff',
          submitFontColor: '#ffffff',
          backgroundColor: '#f8f9fa',
        },
      })

      expect(form.style).toBeDefined()
      expect(form.style?.fontFamily).toBe('Arial')
      expect(form.style?.submitColor).toBe('#007bff')
    })

    it('should create a form with redirect URL', async () => {
      const form = await forms.createForm({
        name: 'Redirect Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
        redirectUrl: 'https://example.com/thank-you',
      })

      expect(form.redirectUrl).toBe('https://example.com/thank-you')
    })

    it('should create a form with inline message', async () => {
      const form = await forms.createForm({
        name: 'Inline Message Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
        inlineMessage: '<p>Thank you for your submission!</p>',
      })

      expect(form.inlineMessage).toBe('<p>Thank you for your submission!</p>')
    })
  })

  describe('getForm', () => {
    it('should get an existing form', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      const retrieved = await forms.getForm(created.id)
      expect(retrieved.id).toBe(created.id)
      expect(retrieved.name).toBe('Test Form')
    })

    it('should throw error for non-existent form', async () => {
      await expect(forms.getForm('non-existent')).rejects.toThrow(HubSpotFormsError)
    })

    it('should throw error for archived form', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })
      await forms.deleteForm(created.id)

      await expect(forms.getForm(created.id)).rejects.toThrow(HubSpotFormsError)
    })
  })

  describe('updateForm', () => {
    it('should update form name', async () => {
      const created = await forms.createForm({
        name: 'Original Name',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      const updated = await forms.updateForm(created.id, { name: 'Updated Name' })
      expect(updated.name).toBe('Updated Name')
    })

    it('should update form fields', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [
          { groupType: 'default_group', fields: [{ name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false }] },
        ],
      })

      const updated = await forms.updateForm(created.id, {
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
              { name: 'name', label: 'Name', fieldType: 'text', required: false, hidden: false },
            ],
          },
        ],
      })

      expect(updated.fieldGroups[0].fields).toHaveLength(2)
    })

    it('should increment version on update', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      const updated = await forms.updateForm(created.id, { name: 'Updated' })
      expect(updated.version).toBe(2)
    })
  })

  describe('deleteForm', () => {
    it('should archive a form', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.deleteForm(created.id)

      // Form should no longer be accessible
      await expect(forms.getForm(created.id)).rejects.toThrow(HubSpotFormsError)
    })
  })

  describe('publishForm', () => {
    it('should publish a draft form', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })
      expect(created.state).toBe('draft')

      const published = await forms.publishForm(created.id)
      expect(published.state).toBe('published')
    })
  })

  describe('unpublishForm', () => {
    it('should unpublish a published form', async () => {
      const created = await forms.createForm({
        name: 'Test Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })
      await forms.publishForm(created.id)

      const unpublished = await forms.unpublishForm(created.id)
      expect(unpublished.state).toBe('draft')
    })
  })

  describe('listForms', () => {
    it('should list all forms', async () => {
      await forms.createForm({ name: 'Form 1', fieldGroups: [{ groupType: 'default_group', fields: [] }] })
      await forms.createForm({ name: 'Form 2', fieldGroups: [{ groupType: 'default_group', fields: [] }] })

      const result = await forms.listForms()
      expect(result.results).toHaveLength(2)
    })

    it('should filter by form type', async () => {
      await forms.createForm({ name: 'HubSpot Form', formType: 'hubspot', fieldGroups: [{ groupType: 'default_group', fields: [] }] })
      await forms.createForm({ name: 'Popup Form', formType: 'popup', fieldGroups: [{ groupType: 'default_group', fields: [] }] })

      const result = await forms.listForms({ formTypes: ['popup'] })
      expect(result.results).toHaveLength(1)
      expect(result.results[0].formType).toBe('popup')
    })

    it('should filter by state', async () => {
      const form1 = await forms.createForm({ name: 'Draft Form', fieldGroups: [{ groupType: 'default_group', fields: [] }] })
      const form2 = await forms.createForm({ name: 'Published Form', fieldGroups: [{ groupType: 'default_group', fields: [] }] })
      await forms.publishForm(form2.id)

      const result = await forms.listForms({ state: 'published' })
      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Published Form')
    })

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await forms.createForm({ name: `Form ${i}`, fieldGroups: [{ groupType: 'default_group', fields: [] }] })
      }

      const page1 = await forms.listForms({ limit: 2 })
      expect(page1.results).toHaveLength(2)
      expect(page1.paging?.next?.after).toBeDefined()
    })
  })

  describe('cloneForm', () => {
    it('should clone a form', async () => {
      const original = await forms.createForm({
        name: 'Original Form',
        fieldGroups: [
          { groupType: 'default_group', fields: [{ name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false }] },
        ],
        redirectUrl: 'https://example.com/thank-you',
      })

      const cloned = await forms.cloneForm(original.id, 'Cloned Form')

      expect(cloned.id).not.toBe(original.id)
      expect(cloned.name).toBe('Cloned Form')
      expect(cloned.fieldGroups).toEqual(original.fieldGroups)
      expect(cloned.redirectUrl).toBe(original.redirectUrl)
    })
  })
})

// =============================================================================
// Form Submission Tests
// =============================================================================

describe('@dotdo/hubspot/forms - Submissions', () => {
  let forms: HubSpotForms
  let storage: TestStorage
  let onSubmission: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storage = new TestStorage()
    onSubmission = vi.fn()
    forms = new HubSpotForms(storage, onSubmission)
  })

  describe('submitForm', () => {
    it('should submit a form with valid data', async () => {
      const form = await forms.createForm({
        name: 'Contact Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
              { name: 'name', label: 'Name', fieldType: 'text', required: false, hidden: false },
            ],
          },
        ],
        inlineMessage: 'Thank you!',
      })

      const result = await forms.submitForm(form.id, {
        fields: [
          { name: 'email', value: 'user@example.com' },
          { name: 'name', value: 'John Doe' },
        ],
      })

      expect(result.inlineMessage).toBe('Thank you!')
      expect(onSubmission).toHaveBeenCalled()
    })

    it('should return redirect URL if configured', async () => {
      const form = await forms.createForm({
        name: 'Redirect Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
        redirectUrl: 'https://example.com/thank-you',
      })

      const result = await forms.submitForm(form.id, { fields: [] })
      expect(result.redirectUri).toBe('https://example.com/thank-you')
    })

    it('should validate required fields', async () => {
      const form = await forms.createForm({
        name: 'Required Fields Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
            ],
          },
        ],
      })

      const result = await forms.submitForm(form.id, {
        fields: [], // Missing required email
      })

      expect(result.errors).toBeDefined()
      expect(result.errors).toHaveLength(1)
      expect(result.errors![0].errorType).toBe('REQUIRED_FIELD')
    })

    it('should validate min/max length', async () => {
      const form = await forms.createForm({
        name: 'Validation Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              {
                name: 'username',
                label: 'Username',
                fieldType: 'text',
                required: true,
                hidden: false,
                validation: {
                  name: 'length',
                  blocksFormSubmission: true,
                  minLength: 3,
                  maxLength: 20,
                },
              },
            ],
          },
        ],
      })

      const result = await forms.submitForm(form.id, {
        fields: [{ name: 'username', value: 'ab' }], // Too short
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].errorType).toBe('MIN_LENGTH')
    })

    it('should validate regex pattern', async () => {
      const form = await forms.createForm({
        name: 'Regex Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              {
                name: 'zipcode',
                label: 'ZIP Code',
                fieldType: 'text',
                required: true,
                hidden: false,
                validation: {
                  name: 'regex',
                  blocksFormSubmission: true,
                  regex: '^\\d{5}$',
                },
              },
            ],
          },
        ],
      })

      const result = await forms.submitForm(form.id, {
        fields: [{ name: 'zipcode', value: 'invalid' }],
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].errorType).toBe('REGEX_MISMATCH')
    })

    it('should skip validation when skipValidation is true', async () => {
      const form = await forms.createForm({
        name: 'Skip Validation Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
            ],
          },
        ],
      })

      const result = await forms.submitForm(form.id, {
        fields: [],
        skipValidation: true,
      })

      expect(result.errors).toBeUndefined()
    })

    it('should include context in submission', async () => {
      const form = await forms.createForm({
        name: 'Context Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, {
        fields: [],
        context: {
          pageUri: 'https://example.com/contact',
          pageName: 'Contact Us',
          ipAddress: '192.168.1.1',
        },
      })

      const submissions = await forms.listSubmissions(form.id)
      expect(submissions.results[0].pageUrl).toBe('https://example.com/contact')
      expect(submissions.results[0].pageName).toBe('Contact Us')
    })
  })

  describe('listSubmissions', () => {
    it('should list all submissions for a form', async () => {
      const form = await forms.createForm({
        name: 'Submission Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, { fields: [] })
      await forms.submitForm(form.id, { fields: [] })
      await forms.submitForm(form.id, { fields: [] })

      const result = await forms.listSubmissions(form.id)
      expect(result.results).toHaveLength(3)
    })

    it('should paginate submissions', async () => {
      const form = await forms.createForm({
        name: 'Pagination Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      for (let i = 0; i < 5; i++) {
        await forms.submitForm(form.id, { fields: [] })
      }

      const page1 = await forms.listSubmissions(form.id, { limit: 2 })
      expect(page1.results).toHaveLength(2)
      expect(page1.paging?.next?.after).toBeDefined()
    })
  })

  describe('getSubmission', () => {
    it('should get a specific submission', async () => {
      const form = await forms.createForm({
        name: 'Get Submission Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, {
        fields: [{ name: 'email', value: 'test@example.com' }],
      })

      const submissions = await forms.listSubmissions(form.id)
      const submission = await forms.getSubmission(submissions.results[0].id)

      expect(submission.values['email']).toBe('test@example.com')
    })

    it('should throw error for non-existent submission', async () => {
      await expect(forms.getSubmission('non-existent')).rejects.toThrow(HubSpotFormsError)
    })
  })

  describe('deleteSubmission', () => {
    it('should delete a submission', async () => {
      const form = await forms.createForm({
        name: 'Delete Submission Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, { fields: [] })
      const submissions = await forms.listSubmissions(form.id)
      expect(submissions.results).toHaveLength(1)

      await forms.deleteSubmission(submissions.results[0].id)

      const updatedSubmissions = await forms.listSubmissions(form.id)
      expect(updatedSubmissions.results).toHaveLength(0)
    })
  })

  describe('getSubmissionCount', () => {
    it('should return submission count', async () => {
      const form = await forms.createForm({
        name: 'Count Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, { fields: [] })
      await forms.submitForm(form.id, { fields: [] })

      const count = await forms.getSubmissionCount(form.id)
      expect(count).toBe(2)
    })
  })
})

// =============================================================================
// Field Management Tests
// =============================================================================

describe('@dotdo/hubspot/forms - Field Management', () => {
  let forms: HubSpotForms
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    forms = new HubSpotForms(storage)
  })

  describe('addField', () => {
    it('should add a field to a form', async () => {
      const form = await forms.createForm({
        name: 'Add Field Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      const updated = await forms.addField(form.id, 0, {
        name: 'email',
        label: 'Email',
        fieldType: 'text',
        required: true,
        hidden: false,
      })

      expect(updated.fieldGroups[0].fields).toHaveLength(1)
      expect(updated.fieldGroups[0].fields[0].name).toBe('email')
    })

    it('should throw error for duplicate field name', async () => {
      const form = await forms.createForm({
        name: 'Duplicate Field Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [{ name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false }],
          },
        ],
      })

      await expect(
        forms.addField(form.id, 0, { name: 'email', label: 'Another Email', fieldType: 'text', required: false, hidden: false })
      ).rejects.toThrow(HubSpotFormsError)
    })
  })

  describe('updateField', () => {
    it('should update an existing field', async () => {
      const form = await forms.createForm({
        name: 'Update Field Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [{ name: 'email', label: 'Email', fieldType: 'text', required: false, hidden: false }],
          },
        ],
      })

      const updated = await forms.updateField(form.id, 'email', { required: true, label: 'Email Address' })

      expect(updated.fieldGroups[0].fields[0].required).toBe(true)
      expect(updated.fieldGroups[0].fields[0].label).toBe('Email Address')
    })

    it('should throw error for non-existent field', async () => {
      const form = await forms.createForm({
        name: 'Update Non-existent Field',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await expect(forms.updateField(form.id, 'missing', { required: true })).rejects.toThrow(HubSpotFormsError)
    })
  })

  describe('removeField', () => {
    it('should remove a field from a form', async () => {
      const form = await forms.createForm({
        name: 'Remove Field Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
              { name: 'name', label: 'Name', fieldType: 'text', required: false, hidden: false },
            ],
          },
        ],
      })

      const updated = await forms.removeField(form.id, 'name')

      expect(updated.fieldGroups[0].fields).toHaveLength(1)
      expect(updated.fieldGroups[0].fields[0].name).toBe('email')
    })
  })

  describe('reorderFields', () => {
    it('should reorder fields in a group', async () => {
      const form = await forms.createForm({
        name: 'Reorder Form',
        fieldGroups: [
          {
            groupType: 'default_group',
            fields: [
              { name: 'email', label: 'Email', fieldType: 'text', required: true, hidden: false },
              { name: 'name', label: 'Name', fieldType: 'text', required: false, hidden: false },
              { name: 'phone', label: 'Phone', fieldType: 'phonenumber', required: false, hidden: false },
            ],
          },
        ],
      })

      const updated = await forms.reorderFields(form.id, 0, ['phone', 'name', 'email'])

      expect(updated.fieldGroups[0].fields[0].name).toBe('phone')
      expect(updated.fieldGroups[0].fields[1].name).toBe('name')
      expect(updated.fieldGroups[0].fields[2].name).toBe('email')
    })
  })
})

// =============================================================================
// Field Group Management Tests
// =============================================================================

describe('@dotdo/hubspot/forms - Field Group Management', () => {
  let forms: HubSpotForms
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    forms = new HubSpotForms(storage)
  })

  describe('addFieldGroup', () => {
    it('should add a field group to a form', async () => {
      const form = await forms.createForm({
        name: 'Add Group Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      const updated = await forms.addFieldGroup(form.id, {
        groupType: 'progressive',
        fields: [{ name: 'company', label: 'Company', fieldType: 'text', required: false, hidden: false }],
      })

      expect(updated.fieldGroups).toHaveLength(2)
      expect(updated.fieldGroups[1].groupType).toBe('progressive')
    })
  })

  describe('removeFieldGroup', () => {
    it('should remove a field group from a form', async () => {
      const form = await forms.createForm({
        name: 'Remove Group Form',
        fieldGroups: [
          { groupType: 'default_group', fields: [] },
          { groupType: 'progressive', fields: [] },
        ],
      })

      const updated = await forms.removeFieldGroup(form.id, 1)

      expect(updated.fieldGroups).toHaveLength(1)
      expect(updated.fieldGroups[0].groupType).toBe('default_group')
    })

    it('should not allow removing the last field group', async () => {
      const form = await forms.createForm({
        name: 'Single Group Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await expect(forms.removeFieldGroup(form.id, 0)).rejects.toThrow(HubSpotFormsError)
    })
  })
})

// =============================================================================
// Statistics Tests
// =============================================================================

describe('@dotdo/hubspot/forms - Statistics', () => {
  let forms: HubSpotForms
  let storage: TestStorage

  beforeEach(() => {
    storage = new TestStorage()
    forms = new HubSpotForms(storage)
  })

  describe('getFormStats', () => {
    it('should return form statistics', async () => {
      const form = await forms.createForm({
        name: 'Stats Form',
        fieldGroups: [{ groupType: 'default_group', fields: [] }],
      })

      await forms.submitForm(form.id, { fields: [] })
      await forms.submitForm(form.id, { fields: [] })

      const stats = await forms.getFormStats(form.id)

      expect(stats.totalSubmissions).toBe(2)
      expect(stats.submissionsLast24h).toBe(2)
      expect(stats.submissionsLast7d).toBe(2)
      expect(stats.submissionsLast30d).toBe(2)
    })
  })
})
