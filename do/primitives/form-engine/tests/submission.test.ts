/**
 * Submission Storage Tests
 *
 * Tests for form submissions including partial saves, draft recovery,
 * and complete submission handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SubmissionStore,
  createSubmissionStore,
  Submission,
} from '../submission'
import { createFormSchema } from '../schema'
import type { FormSchema, FormSubmission, SubmissionStatus, FormData, UploadedFile } from '../types'

describe('SubmissionStore', () => {
  let store: SubmissionStore
  let schema: FormSchema

  beforeEach(() => {
    store = createSubmissionStore()
    schema = createFormSchema({
      id: 'test-form',
      title: 'Test Form',
      steps: [
        {
          id: 'step1',
          title: 'Step 1',
          fields: [
            { id: 'name', type: 'text', label: 'Name', required: true },
            { id: 'email', type: 'email', label: 'Email', required: true },
          ],
        },
        {
          id: 'step2',
          title: 'Step 2',
          fields: [
            { id: 'phone', type: 'phone', label: 'Phone' },
            { id: 'address', type: 'text', label: 'Address' },
          ],
        },
      ],
    })
  })

  describe('Creating Submissions', () => {
    it('should create a new submission', async () => {
      const submission = await store.create({
        formId: 'test-form',
        data: { name: 'John' },
      })

      expect(submission.id).toBeDefined()
      expect(submission.formId).toBe('test-form')
      expect(submission.data.name).toBe('John')
      expect(submission.status).toBe('draft')
      expect(submission.createdAt).toBeInstanceOf(Date)
      expect(submission.updatedAt).toBeInstanceOf(Date)
    })

    it('should generate unique submission IDs', async () => {
      const sub1 = await store.create({ formId: 'test', data: {} })
      const sub2 = await store.create({ formId: 'test', data: {} })

      expect(sub1.id).not.toBe(sub2.id)
    })

    it('should store form version at submission time', async () => {
      const submission = await store.create({
        formId: 'test-form',
        formVersion: '1.0.0',
        data: {},
      })

      expect(submission.formVersion).toBe('1.0.0')
    })

    it('should track metadata', async () => {
      const submission = await store.create({
        formId: 'test-form',
        data: {},
        metadata: {
          source: 'website',
          campaign: 'summer2024',
        },
      })

      expect(submission.metadata?.source).toBe('website')
      expect(submission.metadata?.campaign).toBe('summer2024')
    })

    it('should track user context', async () => {
      const submission = await store.create({
        formId: 'test-form',
        data: {},
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        userId: 'user-123',
      })

      expect(submission.ipAddress).toBe('192.168.1.1')
      expect(submission.userAgent).toBe('Mozilla/5.0...')
      expect(submission.userId).toBe('user-123')
    })
  })

  describe('Partial Saves', () => {
    it('should save partial progress', async () => {
      const submission = await store.create({
        formId: schema.id,
        data: { name: 'John' },
      })

      const updated = await store.update(submission.id, {
        data: { name: 'John', email: 'john@example.com' },
        status: 'partial',
        currentStep: 0,
      })

      expect(updated.status).toBe('partial')
      expect(updated.data.email).toBe('john@example.com')
      expect(updated.currentStep).toBe(0)
    })

    it('should track completed steps', async () => {
      const submission = await store.create({
        formId: schema.id,
        data: {},
      })

      // Complete step 1
      const afterStep1 = await store.update(submission.id, {
        data: { name: 'John', email: 'john@example.com' },
        completedSteps: ['step1'],
        currentStep: 1,
      })

      expect(afterStep1.completedSteps).toContain('step1')
      expect(afterStep1.currentStep).toBe(1)

      // Complete step 2
      const afterStep2 = await store.update(submission.id, {
        data: { name: 'John', email: 'john@example.com', phone: '555-1234' },
        completedSteps: ['step1', 'step2'],
        currentStep: 2,
      })

      expect(afterStep2.completedSteps).toContain('step1')
      expect(afterStep2.completedSteps).toContain('step2')
    })

    it('should auto-save at intervals', async () => {
      vi.useFakeTimers()

      const onSave = vi.fn()
      const autoSaveStore = createSubmissionStore({
        autoSave: true,
        autoSaveInterval: 30000, // 30 seconds
        onAutoSave: onSave,
      })

      const submission = await autoSaveStore.create({
        formId: 'test',
        data: { field1: 'value1' },
      })

      // Modify data
      autoSaveStore.setDraft(submission.id, { field1: 'value1', field2: 'value2' })

      // Advance time
      vi.advanceTimersByTime(30000)

      expect(onSave).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should preserve previous data on partial update', async () => {
      const submission = await store.create({
        formId: 'test',
        data: { field1: 'value1', field2: 'value2' },
      })

      // Update only field1
      const updated = await store.update(submission.id, {
        data: { field1: 'updated' },
        merge: true,
      })

      expect(updated.data.field1).toBe('updated')
      expect(updated.data.field2).toBe('value2')
    })
  })

  describe('Draft Recovery', () => {
    it('should retrieve saved drafts', async () => {
      const submission = await store.create({
        formId: 'test-form',
        data: { name: 'John' },
        status: 'draft',
      })

      const retrieved = await store.get(submission.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.data.name).toBe('John')
    })

    it('should find drafts by form ID', async () => {
      await store.create({ formId: 'form-a', data: { a: 1 } })
      await store.create({ formId: 'form-b', data: { b: 1 } })
      await store.create({ formId: 'form-a', data: { a: 2 } })

      const formADrafts = await store.findByFormId('form-a')

      expect(formADrafts).toHaveLength(2)
      expect(formADrafts.every((d) => d.formId === 'form-a')).toBe(true)
    })

    it('should find drafts by user ID', async () => {
      await store.create({ formId: 'form', data: {}, userId: 'user-1' })
      await store.create({ formId: 'form', data: {}, userId: 'user-2' })
      await store.create({ formId: 'form', data: {}, userId: 'user-1' })

      const userDrafts = await store.findByUserId('user-1')

      expect(userDrafts).toHaveLength(2)
    })

    it('should find most recent draft for user and form', async () => {
      // Create older draft
      const older = await store.create({
        formId: 'form',
        data: { version: 'old' },
        userId: 'user-1',
      })

      // Simulate time passing
      await new Promise((r) => setTimeout(r, 10))

      // Create newer draft
      const newer = await store.create({
        formId: 'form',
        data: { version: 'new' },
        userId: 'user-1',
      })

      const mostRecent = await store.findMostRecentDraft('form', 'user-1')

      expect(mostRecent?.id).toBe(newer.id)
      expect(mostRecent?.data.version).toBe('new')
    })

    it('should restore draft to continue editing', async () => {
      const original = await store.create({
        formId: 'test-form',
        data: { name: 'John', email: 'john@example.com' },
        currentStep: 1,
        completedSteps: ['step1'],
        status: 'partial',
      })

      const restored = await store.restore(original.id)

      expect(restored.data).toEqual(original.data)
      expect(restored.currentStep).toBe(1)
      expect(restored.completedSteps).toContain('step1')
    })

    it('should handle expired drafts', async () => {
      const expireStore = createSubmissionStore({
        draftExpiry: 1000, // 1 second
      })

      const draft = await expireStore.create({
        formId: 'test',
        data: {},
      })

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 1100))

      const expired = await expireStore.get(draft.id)
      expect(expired).toBeNull()
    })
  })

  describe('Complete Submissions', () => {
    it('should mark submission as submitted', async () => {
      const submission = await store.create({
        formId: 'test',
        data: { field: 'value' },
      })

      const submitted = await store.submit(submission.id)

      expect(submitted.status).toBe('submitted')
    })

    it('should set completedAt timestamp', async () => {
      const submission = await store.create({
        formId: 'test',
        data: { field: 'value' },
      })

      const submitted = await store.submit(submission.id)

      expect(submitted.completedAt).toBeInstanceOf(Date)
    })

    it('should transition through processing status', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      // Submit
      const submitted = await store.submit(submission.id)
      expect(submitted.status).toBe('submitted')

      // Start processing
      const processing = await store.update(submission.id, { status: 'processing' })
      expect(processing.status).toBe('processing')

      // Complete
      const completed = await store.update(submission.id, { status: 'completed' })
      expect(completed.status).toBe('completed')
    })

    it('should handle failed submissions', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      const failed = await store.update(submission.id, {
        status: 'failed',
        errors: [{ field: 'payment', rule: 'custom', message: 'Payment declined' }],
      })

      expect(failed.status).toBe('failed')
      expect(failed.errors).toHaveLength(1)
    })

    it('should prevent resubmission of completed forms', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      await store.submit(submission.id)
      await store.update(submission.id, { status: 'completed' })

      await expect(store.submit(submission.id)).rejects.toThrow(/already completed/)
    })
  })

  describe('File Attachments', () => {
    it('should attach files to submission', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      const file: UploadedFile = {
        id: 'file-1',
        name: 'document.pdf',
        size: 1024,
        type: 'application/pdf',
        url: 'https://storage.example.com/file-1.pdf',
        uploadedAt: new Date(),
      }

      const withFile = await store.attachFile(submission.id, file)

      expect(withFile.files).toHaveLength(1)
      expect(withFile.files![0].name).toBe('document.pdf')
    })

    it('should attach multiple files', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      const files: UploadedFile[] = [
        { id: 'f1', name: 'doc1.pdf', size: 100, type: 'application/pdf', uploadedAt: new Date() },
        { id: 'f2', name: 'doc2.pdf', size: 200, type: 'application/pdf', uploadedAt: new Date() },
      ]

      const withFiles = await store.attachFiles(submission.id, files)

      expect(withFiles.files).toHaveLength(2)
    })

    it('should remove file attachment', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
        files: [
          { id: 'f1', name: 'doc1.pdf', size: 100, type: 'application/pdf', uploadedAt: new Date() },
          { id: 'f2', name: 'doc2.pdf', size: 200, type: 'application/pdf', uploadedAt: new Date() },
        ],
      })

      const afterRemove = await store.removeFile(submission.id, 'f1')

      expect(afterRemove.files).toHaveLength(1)
      expect(afterRemove.files![0].id).toBe('f2')
    })
  })

  describe('Payment Handling', () => {
    it('should store payment results', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      const withPayment = await store.addPayment(submission.id, {
        success: true,
        transactionId: 'txn_123',
        amount: 9900,
        currency: 'usd',
        provider: 'stripe',
      })

      expect(withPayment.payments).toHaveLength(1)
      expect(withPayment.payments![0].transactionId).toBe('txn_123')
    })

    it('should handle payment failures', async () => {
      const submission = await store.create({
        formId: 'test',
        data: {},
      })

      const withFailedPayment = await store.addPayment(submission.id, {
        success: false,
        error: 'Card declined',
        provider: 'stripe',
      })

      expect(withFailedPayment.payments![0].success).toBe(false)
      expect(withFailedPayment.payments![0].error).toBe('Card declined')
    })
  })

  describe('Querying Submissions', () => {
    beforeEach(async () => {
      // Seed test data
      await store.create({ formId: 'form-a', data: {}, status: 'draft' })
      await store.create({ formId: 'form-a', data: {}, status: 'submitted' })
      await store.create({ formId: 'form-a', data: {}, status: 'completed' })
      await store.create({ formId: 'form-b', data: {}, status: 'draft' })
    })

    it('should filter by status', async () => {
      const drafts = await store.query({ status: 'draft' })
      expect(drafts).toHaveLength(2)
    })

    it('should filter by form ID', async () => {
      const formA = await store.query({ formId: 'form-a' })
      expect(formA).toHaveLength(3)
    })

    it('should filter by multiple criteria', async () => {
      const completedFormA = await store.query({ formId: 'form-a', status: 'completed' })
      expect(completedFormA).toHaveLength(1)
    })

    it('should support pagination', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 })
      const page2 = await store.query({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
    })

    it('should sort by date', async () => {
      const oldest = await store.query({ sortBy: 'createdAt', sortOrder: 'asc' })
      const newest = await store.query({ sortBy: 'createdAt', sortOrder: 'desc' })

      expect(oldest[0].createdAt <= oldest[1].createdAt).toBe(true)
      expect(newest[0].createdAt >= newest[1].createdAt).toBe(true)
    })

    it('should filter by date range', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      const recent = await store.query({
        createdAfter: yesterday,
        createdBefore: now,
      })

      expect(recent.length).toBeGreaterThan(0)
    })
  })

  describe('Deletion', () => {
    it('should delete submission', async () => {
      const submission = await store.create({ formId: 'test', data: {} })

      await store.delete(submission.id)

      const deleted = await store.get(submission.id)
      expect(deleted).toBeNull()
    })

    it('should soft delete by default', async () => {
      const softStore = createSubmissionStore({ softDelete: true })
      const submission = await softStore.create({ formId: 'test', data: {} })

      await softStore.delete(submission.id)

      // Should not appear in normal queries
      const normal = await softStore.get(submission.id)
      expect(normal).toBeNull()

      // Should appear with includeDeleted
      const withDeleted = await softStore.get(submission.id, { includeDeleted: true })
      expect(withDeleted).toBeDefined()
    })

    it('should permanently delete when requested', async () => {
      const submission = await store.create({ formId: 'test', data: {} })

      await store.delete(submission.id, { permanent: true })

      const gone = await store.get(submission.id, { includeDeleted: true })
      expect(gone).toBeNull()
    })

    it('should delete all drafts for a form', async () => {
      await store.create({ formId: 'form-x', data: {}, status: 'draft' })
      await store.create({ formId: 'form-x', data: {}, status: 'draft' })
      await store.create({ formId: 'form-x', data: {}, status: 'completed' })

      const deleted = await store.deleteDrafts('form-x')

      expect(deleted).toBe(2)

      const remaining = await store.findByFormId('form-x')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].status).toBe('completed')
    })
  })

  describe('Events', () => {
    it('should emit create event', async () => {
      const onCreate = vi.fn()
      store.on('create', onCreate)

      await store.create({ formId: 'test', data: {} })

      expect(onCreate).toHaveBeenCalled()
    })

    it('should emit update event', async () => {
      const onUpdate = vi.fn()
      store.on('update', onUpdate)

      const submission = await store.create({ formId: 'test', data: {} })
      await store.update(submission.id, { data: { updated: true } })

      expect(onUpdate).toHaveBeenCalled()
    })

    it('should emit submit event', async () => {
      const onSubmit = vi.fn()
      store.on('submit', onSubmit)

      const submission = await store.create({ formId: 'test', data: {} })
      await store.submit(submission.id)

      expect(onSubmit).toHaveBeenCalled()
    })

    it('should emit status change events', async () => {
      const onStatusChange = vi.fn()
      store.on('statusChange', onStatusChange)

      const submission = await store.create({ formId: 'test', data: {} })
      await store.update(submission.id, { status: 'partial' })
      await store.update(submission.id, { status: 'submitted' })

      expect(onStatusChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('Validation Integration', () => {
    it('should validate before submission', async () => {
      const submission = await store.create({
        formId: schema.id,
        data: { name: '' }, // Missing required email
      })

      await expect(
        store.submit(submission.id, { validate: true, schema })
      ).rejects.toThrow(/validation/)
    })

    it('should store validation errors', async () => {
      const submission = await store.create({
        formId: schema.id,
        data: { name: '', email: 'invalid' },
      })

      try {
        await store.submit(submission.id, { validate: true, schema })
      } catch {
        const updated = await store.get(submission.id)
        expect(updated?.errors).toBeDefined()
        expect(updated?.errors?.length).toBeGreaterThan(0)
      }
    })
  })
})
