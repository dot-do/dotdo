/**
 * FormEngine Submission Storage Module
 *
 * Handles form submissions including drafts, partial saves, and file attachments
 */

import type {
  FormSchema,
  FormSubmission,
  SubmissionStatus,
  FormData,
  UploadedFile,
  PaymentResult,
  FieldError,
} from './types'
import { validate as validateForm } from './validation'

// ============================================================================
// TYPES
// ============================================================================

export interface CreateSubmissionInput {
  formId: string
  formVersion?: string
  data: FormData
  status?: SubmissionStatus
  currentStep?: number
  completedSteps?: string[]
  files?: UploadedFile[]
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  userId?: string
}

export interface UpdateSubmissionInput {
  data?: FormData
  status?: SubmissionStatus
  currentStep?: number
  completedSteps?: string[]
  metadata?: Record<string, unknown>
  errors?: FieldError[]
  merge?: boolean
}

export interface SubmissionQuery {
  formId?: string
  status?: SubmissionStatus
  userId?: string
  limit?: number
  offset?: number
  sortBy?: 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  createdAfter?: Date
  createdBefore?: Date
}

export interface SubmitOptions {
  validate?: boolean
  schema?: FormSchema
}

export interface GetOptions {
  includeDeleted?: boolean
}

export interface DeleteOptions {
  permanent?: boolean
}

export interface SubmissionStoreOptions {
  autoSave?: boolean
  autoSaveInterval?: number
  onAutoSave?: (submission: FormSubmission) => void
  draftExpiry?: number
  softDelete?: boolean
}

export type SubmissionEventType = 'create' | 'update' | 'submit' | 'statusChange' | 'delete'

export { FormSubmission as Submission }

// ============================================================================
// SUBMISSION STORE CLASS
// ============================================================================

export class SubmissionStore {
  private submissions: Map<string, FormSubmission> = new Map()
  private deletedSubmissions: Set<string> = new Set()
  private options: SubmissionStoreOptions
  private eventListeners: Map<SubmissionEventType, Array<(data: unknown) => void>> = new Map()
  private drafts: Map<string, FormData> = new Map()
  private autoSaveTimers: Map<string, ReturnType<typeof setInterval>> = new Map()

  constructor(options: SubmissionStoreOptions = {}) {
    this.options = options
  }

  /**
   * Create a new submission
   */
  async create(input: CreateSubmissionInput): Promise<FormSubmission> {
    const id = this.generateId()
    const now = new Date()

    const submission: FormSubmission = {
      id,
      formId: input.formId,
      formVersion: input.formVersion,
      status: input.status || 'draft',
      data: input.data,
      currentStep: input.currentStep,
      completedSteps: input.completedSteps,
      files: input.files,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: input.userId,
      createdAt: now,
      updatedAt: now,
    }

    this.submissions.set(id, submission)
    this.emit('create', submission)

    if (this.options.autoSave && this.options.autoSaveInterval) {
      this.setupAutoSave(id)
    }

    return submission
  }

  /**
   * Get a submission by ID
   */
  async get(id: string, options: GetOptions = {}): Promise<FormSubmission | null> {
    // Check if deleted
    if (this.deletedSubmissions.has(id) && !options.includeDeleted) {
      return null
    }

    const submission = this.submissions.get(id)

    // Check expiry for drafts
    if (submission && this.options.draftExpiry && submission.status === 'draft') {
      const age = Date.now() - submission.createdAt.getTime()
      if (age > this.options.draftExpiry) {
        this.submissions.delete(id)
        return null
      }
    }

    return submission || null
  }

  /**
   * Update a submission
   */
  async update(id: string, input: UpdateSubmissionInput): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    const previousStatus = submission.status

    // Merge or replace data
    if (input.data) {
      if (input.merge) {
        submission.data = { ...submission.data, ...input.data }
      } else {
        submission.data = input.data
      }
    }

    if (input.status) {
      submission.status = input.status
    }

    if (input.currentStep !== undefined) {
      submission.currentStep = input.currentStep
    }

    if (input.completedSteps) {
      submission.completedSteps = input.completedSteps
    }

    if (input.metadata) {
      submission.metadata = { ...submission.metadata, ...input.metadata }
    }

    if (input.errors) {
      submission.errors = input.errors
    }

    submission.updatedAt = new Date()

    this.emit('update', submission)

    if (input.status && input.status !== previousStatus) {
      this.emit('statusChange', { submission, from: previousStatus, to: input.status })
    }

    return submission
  }

  /**
   * Submit a form
   */
  async submit(id: string, options: SubmitOptions = {}): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    if (submission.status === 'completed') {
      throw new Error('Form already completed')
    }

    // Validate if requested
    if (options.validate && options.schema) {
      const result = validateForm(options.schema, submission.data)
      if (!result.valid) {
        submission.errors = result.errors
        throw new Error('Form validation failed')
      }
    }

    submission.status = 'submitted'
    submission.updatedAt = new Date()

    this.emit('submit', submission)
    this.emit('statusChange', { submission, from: 'draft', to: 'submitted' })

    return submission
  }

  /**
   * Mark submission as complete
   */
  async complete(id: string): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    submission.status = 'completed'
    submission.completedAt = new Date()
    submission.updatedAt = new Date()

    this.emit('statusChange', { submission, from: submission.status, to: 'completed' })

    return submission
  }

  /**
   * Restore a draft for editing
   */
  async restore(id: string): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    return submission
  }

  /**
   * Attach a file to a submission
   */
  async attachFile(id: string, file: UploadedFile): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    submission.files = submission.files || []
    submission.files.push(file)
    submission.updatedAt = new Date()

    return submission
  }

  /**
   * Attach multiple files
   */
  async attachFiles(id: string, files: UploadedFile[]): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    submission.files = submission.files || []
    submission.files.push(...files)
    submission.updatedAt = new Date()

    return submission
  }

  /**
   * Remove a file from a submission
   */
  async removeFile(id: string, fileId: string): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    if (submission.files) {
      submission.files = submission.files.filter(f => f.id !== fileId)
    }
    submission.updatedAt = new Date()

    return submission
  }

  /**
   * Add a payment result
   */
  async addPayment(id: string, payment: PaymentResult): Promise<FormSubmission> {
    const submission = await this.get(id)
    if (!submission) {
      throw new Error(`Submission not found: ${id}`)
    }

    submission.payments = submission.payments || []
    submission.payments.push(payment)
    submission.updatedAt = new Date()

    return submission
  }

  // ============================================================================
  // QUERYING
  // ============================================================================

  /**
   * Find submissions by form ID
   */
  async findByFormId(formId: string): Promise<FormSubmission[]> {
    return this.query({ formId })
  }

  /**
   * Find submissions by user ID
   */
  async findByUserId(userId: string): Promise<FormSubmission[]> {
    return this.query({ userId })
  }

  /**
   * Find the most recent draft for a user and form
   */
  async findMostRecentDraft(formId: string, userId: string): Promise<FormSubmission | null> {
    const drafts = await this.query({
      formId,
      userId,
      status: 'draft',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 1,
    })

    return drafts[0] || null
  }

  /**
   * Query submissions
   */
  async query(query: SubmissionQuery): Promise<FormSubmission[]> {
    let results = Array.from(this.submissions.values())
      .filter(s => !this.deletedSubmissions.has(s.id))

    // Apply filters
    if (query.formId) {
      results = results.filter(s => s.formId === query.formId)
    }

    if (query.status) {
      results = results.filter(s => s.status === query.status)
    }

    if (query.userId) {
      results = results.filter(s => s.userId === query.userId)
    }

    if (query.createdAfter) {
      results = results.filter(s => s.createdAt >= query.createdAfter!)
    }

    if (query.createdBefore) {
      results = results.filter(s => s.createdAt <= query.createdBefore!)
    }

    // Apply sorting
    const sortBy = query.sortBy || 'createdAt'
    const sortOrder = query.sortOrder || 'desc'

    results.sort((a, b) => {
      const aVal = sortBy === 'createdAt' ? a.createdAt.getTime() : a.updatedAt.getTime()
      const bVal = sortBy === 'createdAt' ? b.createdAt.getTime() : b.updatedAt.getTime()
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })

    // Apply pagination
    if (query.offset !== undefined) {
      results = results.slice(query.offset)
    }

    if (query.limit !== undefined) {
      results = results.slice(0, query.limit)
    }

    return results
  }

  // ============================================================================
  // DELETION
  // ============================================================================

  /**
   * Delete a submission
   */
  async delete(id: string, options: DeleteOptions = {}): Promise<void> {
    if (options.permanent || !this.options.softDelete) {
      this.submissions.delete(id)
      this.deletedSubmissions.delete(id)
    } else {
      this.deletedSubmissions.add(id)
    }

    this.emit('delete', { id, permanent: options.permanent })
  }

  /**
   * Delete all drafts for a form
   */
  async deleteDrafts(formId: string): Promise<number> {
    const drafts = await this.query({ formId, status: 'draft' })
    let count = 0

    for (const draft of drafts) {
      await this.delete(draft.id)
      count++
    }

    return count
  }

  // ============================================================================
  // DRAFT MANAGEMENT
  // ============================================================================

  /**
   * Set draft data (for auto-save)
   */
  setDraft(id: string, data: FormData): void {
    this.drafts.set(id, data)
  }

  /**
   * Get draft data
   */
  getDraft(id: string): FormData | undefined {
    return this.drafts.get(id)
  }

  /**
   * Setup auto-save for a submission
   */
  private setupAutoSave(id: string): void {
    if (this.autoSaveTimers.has(id)) {
      return
    }

    const timer = setInterval(() => {
      const draftData = this.drafts.get(id)
      if (draftData) {
        const submission = this.submissions.get(id)
        if (submission) {
          submission.data = draftData
          submission.updatedAt = new Date()
          this.options.onAutoSave?.(submission)
        }
        this.drafts.delete(id)
      }
    }, this.options.autoSaveInterval)

    this.autoSaveTimers.set(id, timer)
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Register an event listener
   */
  on(event: SubmissionEventType, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: SubmissionEventType, data: unknown): void {
    const listeners = this.eventListeners.get(event) || []
    for (const listener of listeners) {
      listener(data)
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private generateId(): string {
    return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createSubmissionStore(options?: SubmissionStoreOptions): SubmissionStore {
  return new SubmissionStore(options)
}
