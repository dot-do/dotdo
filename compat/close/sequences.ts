/**
 * @dotdo/close/sequences - Sales Sequences Compatibility Layer
 *
 * Local implementation of Close-style sales sequences (multi-step outreach campaigns).
 * Supports email, call, LinkedIn, and SMS steps with configurable delays.
 *
 * @example
 * ```typescript
 * import { SequenceClient } from '@dotdo/close/sequences'
 *
 * const sequences = new SequenceClient({ storage: ctx.storage })
 *
 * // Create a sequence template
 * const template = await sequences.templates.create({
 *   name: 'Cold Outreach',
 *   steps: [
 *     { type: 'email', delay: 0, subject: 'Quick question', body: 'Hi {{name}}...' },
 *     { type: 'email', delay: 3, subject: 'Following up', body: 'Just checking in...' },
 *     { type: 'call', delay: 5, note: 'Intro call attempt' },
 *     { type: 'linkedin', delay: 7, action: 'connect', message: 'Hi {{name}}, ...' },
 *     { type: 'email', delay: 10, subject: 'Last attempt', body: 'Final follow-up...' },
 *   ],
 * })
 *
 * // Enroll a contact
 * const enrollment = await sequences.enrollments.create({
 *   template_id: template.id,
 *   contact_id: 'cont_abc123',
 *   lead_id: 'lead_xyz456',
 *   variables: { name: 'John' },
 * })
 *
 * // Execute next step
 * const step = await sequences.enrollments.executeNextStep(enrollment.id)
 * ```
 *
 * @module @dotdo/close/sequences
 */

import type { CloseStorage, Contact, Lead } from './index'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Step types for sales sequences
 */
export type SequenceStepType = 'email' | 'call' | 'sms' | 'linkedin' | 'task' | 'wait'

/**
 * LinkedIn action types
 */
export type LinkedInAction = 'connect' | 'message' | 'view_profile' | 'endorse'

/**
 * Step execution status
 */
export type StepExecutionStatus =
  | 'pending'
  | 'scheduled'
  | 'executing'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'bounced'
  | 'replied'

/**
 * Enrollment status
 */
export type EnrollmentStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'

/**
 * Base step definition
 */
export interface BaseStep {
  /** Step order (1-based) */
  step: number
  /** Step type */
  type: SequenceStepType
  /** Days to wait before this step (0 = immediate) */
  delay: number
  /** Optional step name */
  name?: string
  /** Skip weekends when calculating delay */
  skipWeekends?: boolean
  /** Time of day to execute (e.g., "09:00") */
  sendTime?: string
  /** Timezone for send time */
  timezone?: string
}

/**
 * Email step definition
 */
export interface EmailStep extends BaseStep {
  type: 'email'
  subject: string
  body: string
  bodyHtml?: string
  /** From address override */
  from?: string
  /** CC addresses */
  cc?: string[]
  /** BCC addresses */
  bcc?: string[]
  /** Track opens */
  trackOpens?: boolean
  /** Track clicks */
  trackClicks?: boolean
  /** A/B variant */
  variant?: 'A' | 'B'
}

/**
 * Call step definition
 */
export interface CallStep extends BaseStep {
  type: 'call'
  /** Call script or notes */
  note?: string
  /** Expected duration in seconds */
  duration?: number
  /** Phone number to call (or use contact's phone) */
  phone?: string
  /** Voicemail script */
  voicemailScript?: string
}

/**
 * SMS step definition
 */
export interface SMSStep extends BaseStep {
  type: 'sms'
  text: string
  /** Phone number to text (or use contact's phone) */
  phone?: string
}

/**
 * LinkedIn step definition
 */
export interface LinkedInStep extends BaseStep {
  type: 'linkedin'
  action: LinkedInAction
  /** Connection request or message text */
  message?: string
  /** Profile URL (if not derived from contact) */
  profileUrl?: string
}

/**
 * Task step definition
 */
export interface TaskStep extends BaseStep {
  type: 'task'
  text: string
  /** Assign to user (default: sequence owner) */
  assignTo?: string
  /** Task priority */
  priority?: 'high' | 'normal' | 'low'
}

/**
 * Wait step (pure delay, no action)
 */
export interface WaitStep extends BaseStep {
  type: 'wait'
}

/**
 * Union of all step types
 */
export type SequenceStep =
  | EmailStep
  | CallStep
  | SMSStep
  | LinkedInStep
  | TaskStep
  | WaitStep

/**
 * Sequence template definition
 */
export interface SequenceTemplate {
  id: string
  name: string
  description?: string
  /** Sequence steps */
  steps: SequenceStep[]
  /** Active/inactive */
  active: boolean
  /** Exit conditions */
  exitConditions?: ExitCondition[]
  /** Default variables */
  defaultVariables?: Record<string, unknown>
  /** Owner user ID */
  userId?: string
  /** Organization ID */
  organizationId?: string
  /** Tags for organization */
  tags?: string[]
  /** Statistics */
  stats?: SequenceStats
  date_created: string
  date_updated: string
}

/**
 * Exit conditions for sequence
 */
export interface ExitCondition {
  type: 'reply' | 'bounce' | 'unsubscribe' | 'meeting_booked' | 'opportunity_created' | 'custom'
  /** Custom condition field (for type: 'custom') */
  field?: string
  /** Custom condition value */
  value?: unknown
}

/**
 * Sequence statistics
 */
export interface SequenceStats {
  totalEnrolled: number
  activeEnrollments: number
  completedEnrollments: number
  repliedCount: number
  bouncedCount: number
  stoppedCount: number
  emailsSent: number
  emailsOpened: number
  emailsClicked: number
  callsMade: number
  callsConnected: number
  smsSent: number
  linkedInActions: number
}

/**
 * Sequence enrollment (contact in a sequence)
 */
export interface SequenceEnrollment {
  id: string
  /** Sequence template ID */
  templateId: string
  /** Template name (denormalized for convenience) */
  templateName?: string
  /** Contact being enrolled */
  contactId: string
  /** Lead associated with contact */
  leadId: string
  /** Contact email (denormalized) */
  contactEmail?: string
  /** Contact name (denormalized) */
  contactName?: string
  /** Current step number (1-based) */
  currentStep: number
  /** Enrollment status */
  status: EnrollmentStatus
  /** Variable substitutions */
  variables: Record<string, unknown>
  /** Step execution history */
  stepHistory: StepExecution[]
  /** User who enrolled the contact */
  enrolledBy?: string
  /** When enrollment started */
  startedAt: string
  /** When enrollment completed/stopped */
  completedAt?: string
  /** Pause reason if paused */
  pauseReason?: string
  /** Next step scheduled time */
  nextStepAt?: string
  date_created: string
  date_updated: string
}

/**
 * Individual step execution record
 */
export interface StepExecution {
  step: number
  type: SequenceStepType
  status: StepExecutionStatus
  scheduledAt: string
  executedAt?: string
  /** Activity ID created (email, call, etc.) */
  activityId?: string
  /** Error message if failed */
  error?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Input Types
// =============================================================================

export interface SequenceTemplateCreateInput {
  name: string
  description?: string
  steps: Omit<SequenceStep, 'step'>[]
  active?: boolean
  exitConditions?: ExitCondition[]
  defaultVariables?: Record<string, unknown>
  tags?: string[]
}

export interface SequenceTemplateUpdateInput {
  name?: string
  description?: string
  steps?: Omit<SequenceStep, 'step'>[]
  active?: boolean
  exitConditions?: ExitCondition[]
  defaultVariables?: Record<string, unknown>
  tags?: string[]
}

export interface EnrollmentCreateInput {
  templateId: string
  contactId: string
  leadId: string
  variables?: Record<string, unknown>
  startAt?: string
  enrolledBy?: string
}

export interface EnrollmentUpdateInput {
  status?: EnrollmentStatus
  variables?: Record<string, unknown>
  pauseReason?: string
}

export interface BulkEnrollInput {
  templateId: string
  contacts: Array<{
    contactId: string
    leadId: string
    variables?: Record<string, unknown>
  }>
  enrolledBy?: string
}

// =============================================================================
// Response Types
// =============================================================================

export interface SequenceResponse<T> {
  data: T[]
  has_more: boolean
  total_results?: number
}

export interface ListOptions {
  _skip?: number
  _limit?: number
}

export interface StepExecutionResult {
  enrollment: SequenceEnrollment
  step: StepExecution
  activityId?: string
  nextStepAt?: string
}

// =============================================================================
// Error Class
// =============================================================================

export class SequenceError extends Error {
  errorCode: string
  httpStatus: number
  details?: Record<string, unknown>

  constructor(
    message: string,
    errorCode: string,
    httpStatus: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SequenceError'
    this.errorCode = errorCode
    this.httpStatus = httpStatus
    this.details = details
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = ''
  for (let i = 0; i < 22; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `${prefix}_${id}`
}

function now(): string {
  return new Date().toISOString()
}

/**
 * Calculate next step execution time based on delay
 */
function calculateNextStepTime(
  fromDate: Date,
  delayDays: number,
  skipWeekends: boolean,
  sendTime?: string,
  timezone?: string
): Date {
  const result = new Date(fromDate)

  // Add delay days
  let daysToAdd = delayDays
  while (daysToAdd > 0) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    // Skip weekends if configured
    if (skipWeekends && (day === 0 || day === 6)) {
      continue
    }
    daysToAdd--
  }

  // Set send time if specified
  if (sendTime) {
    const [hours, minutes] = sendTime.split(':').map(Number)
    result.setHours(hours, minutes, 0, 0)
  }

  return result
}

/**
 * Interpolate variables in template string
 */
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return String(variables[key] ?? match)
  })
}

// =============================================================================
// Storage Adapter
// =============================================================================

class MapStorageAdapter implements CloseStorage {
  constructor(private map: Map<string, unknown>) {}

  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, value)
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  keys(): IterableIterator<string> {
    return this.map.keys()
  }
}

// =============================================================================
// Templates Resource
// =============================================================================

class TemplatesResource {
  private storage: CloseStorage
  private prefix = 'close:seqtemplate:'

  constructor(storage: CloseStorage) {
    this.storage = storage
  }

  private getAll(): SequenceTemplate[] {
    const templates: SequenceTemplate[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const template = this.storage.get<SequenceTemplate>(key)
        if (template) {
          templates.push(template)
        }
      }
    }
    return templates
  }

  async create(input: SequenceTemplateCreateInput): Promise<SequenceTemplate> {
    const id = generateId('seqt')
    const timestamp = now()

    // Number the steps
    const steps = input.steps.map((step, index) => ({
      ...step,
      step: index + 1,
    })) as SequenceStep[]

    const template: SequenceTemplate = {
      id,
      name: input.name,
      description: input.description,
      steps,
      active: input.active ?? true,
      exitConditions: input.exitConditions,
      defaultVariables: input.defaultVariables,
      tags: input.tags,
      stats: {
        totalEnrolled: 0,
        activeEnrollments: 0,
        completedEnrollments: 0,
        repliedCount: 0,
        bouncedCount: 0,
        stoppedCount: 0,
        emailsSent: 0,
        emailsOpened: 0,
        emailsClicked: 0,
        callsMade: 0,
        callsConnected: 0,
        smsSent: 0,
        linkedInActions: 0,
      },
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, template)
    return template
  }

  async get(id: string): Promise<SequenceTemplate | null> {
    return this.storage.get<SequenceTemplate>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: SequenceTemplateUpdateInput): Promise<SequenceTemplate> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Sequence template not found: ${id}`, 'NOT_FOUND', 404)
    }

    // Renumber steps if provided
    let steps = existing.steps
    if (input.steps) {
      steps = input.steps.map((step, index) => ({
        ...step,
        step: index + 1,
      })) as SequenceStep[]
    }

    const updated: SequenceTemplate = {
      ...existing,
      ...input,
      steps,
      id,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Sequence template not found: ${id}`, 'NOT_FOUND', 404)
    }
    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(options?: ListOptions & { active?: boolean; tags?: string[] }): Promise<SequenceResponse<SequenceTemplate>> {
    let all = this.getAll()

    // Filter by active status
    if (options?.active !== undefined) {
      all = all.filter((t) => t.active === options.active)
    }

    // Filter by tags
    if (options?.tags && options.tags.length > 0) {
      all = all.filter((t) =>
        t.tags?.some((tag) => options.tags!.includes(tag))
      )
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
      total_results: all.length,
    }
  }

  async duplicate(id: string, newName?: string): Promise<SequenceTemplate> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Sequence template not found: ${id}`, 'NOT_FOUND', 404)
    }

    return this.create({
      name: newName ?? `${existing.name} (Copy)`,
      description: existing.description,
      steps: existing.steps.map(({ step: _, ...rest }) => rest),
      active: false, // Copies start inactive
      exitConditions: existing.exitConditions,
      defaultVariables: existing.defaultVariables,
      tags: existing.tags,
    })
  }
}

// =============================================================================
// Enrollments Resource
// =============================================================================

class EnrollmentsResource {
  private storage: CloseStorage
  private prefix = 'close:seqenroll:'
  private templates: TemplatesResource

  constructor(storage: CloseStorage, templates: TemplatesResource) {
    this.storage = storage
    this.templates = templates
  }

  private getAll(): SequenceEnrollment[] {
    const enrollments: SequenceEnrollment[] = []
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.prefix)) {
        const enrollment = this.storage.get<SequenceEnrollment>(key)
        if (enrollment) {
          enrollments.push(enrollment)
        }
      }
    }
    return enrollments
  }

  async create(input: EnrollmentCreateInput): Promise<SequenceEnrollment> {
    // Verify template exists
    const template = await this.templates.get(input.templateId)
    if (!template) {
      throw new SequenceError(`Sequence template not found: ${input.templateId}`, 'TEMPLATE_NOT_FOUND', 404)
    }

    if (!template.active) {
      throw new SequenceError(`Sequence template is not active: ${input.templateId}`, 'TEMPLATE_INACTIVE', 400)
    }

    // Check for existing active enrollment
    const existing = this.getAll().find(
      (e) =>
        e.contactId === input.contactId &&
        e.templateId === input.templateId &&
        e.status === 'active'
    )
    if (existing) {
      throw new SequenceError(
        `Contact already enrolled in this sequence: ${input.contactId}`,
        'ALREADY_ENROLLED',
        409
      )
    }

    const id = generateId('seqe')
    const timestamp = now()

    // Merge variables with template defaults
    const variables = {
      ...template.defaultVariables,
      ...input.variables,
    }

    // Calculate first step time
    const startAt = input.startAt ? new Date(input.startAt) : new Date()
    const firstStep = template.steps[0]
    const nextStepAt = firstStep
      ? calculateNextStepTime(
          startAt,
          firstStep.delay,
          firstStep.skipWeekends ?? false,
          firstStep.sendTime,
          firstStep.timezone
        ).toISOString()
      : undefined

    const enrollment: SequenceEnrollment = {
      id,
      templateId: input.templateId,
      templateName: template.name,
      contactId: input.contactId,
      leadId: input.leadId,
      currentStep: 1,
      status: 'active',
      variables,
      stepHistory: [],
      enrolledBy: input.enrolledBy,
      startedAt: timestamp,
      nextStepAt,
      date_created: timestamp,
      date_updated: timestamp,
    }

    this.storage.set(`${this.prefix}${id}`, enrollment)

    // Update template stats
    template.stats = template.stats ?? {} as SequenceStats
    template.stats.totalEnrolled = (template.stats.totalEnrolled ?? 0) + 1
    template.stats.activeEnrollments = (template.stats.activeEnrollments ?? 0) + 1
    this.storage.set(`close:seqtemplate:${template.id}`, template)

    return enrollment
  }

  async get(id: string): Promise<SequenceEnrollment | null> {
    return this.storage.get<SequenceEnrollment>(`${this.prefix}${id}`) ?? null
  }

  async update(id: string, input: EnrollmentUpdateInput): Promise<SequenceEnrollment> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Enrollment not found: ${id}`, 'NOT_FOUND', 404)
    }

    const previousStatus = existing.status

    const updated: SequenceEnrollment = {
      ...existing,
      ...input,
      variables: input.variables
        ? { ...existing.variables, ...input.variables }
        : existing.variables,
      id,
      date_updated: now(),
    }

    // Handle status changes
    if (input.status && input.status !== previousStatus) {
      if (['completed', 'stopped', 'replied', 'bounced', 'unsubscribed'].includes(input.status)) {
        updated.completedAt = now()
        updated.nextStepAt = undefined

        // Update template stats
        const template = await this.templates.get(existing.templateId)
        if (template && template.stats) {
          template.stats.activeEnrollments = Math.max(0, (template.stats.activeEnrollments ?? 1) - 1)
          if (input.status === 'completed') {
            template.stats.completedEnrollments = (template.stats.completedEnrollments ?? 0) + 1
          } else if (input.status === 'replied') {
            template.stats.repliedCount = (template.stats.repliedCount ?? 0) + 1
          } else if (input.status === 'bounced') {
            template.stats.bouncedCount = (template.stats.bouncedCount ?? 0) + 1
          } else if (input.status === 'stopped') {
            template.stats.stoppedCount = (template.stats.stoppedCount ?? 0) + 1
          }
          this.storage.set(`close:seqtemplate:${template.id}`, template)
        }
      }
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Enrollment not found: ${id}`, 'NOT_FOUND', 404)
    }

    // Update template stats if active
    if (existing.status === 'active') {
      const template = await this.templates.get(existing.templateId)
      if (template && template.stats) {
        template.stats.activeEnrollments = Math.max(0, (template.stats.activeEnrollments ?? 1) - 1)
        this.storage.set(`close:seqtemplate:${template.id}`, template)
      }
    }

    this.storage.delete(`${this.prefix}${id}`)
  }

  async list(
    options?: ListOptions & {
      templateId?: string
      contactId?: string
      leadId?: string
      status?: EnrollmentStatus
    }
  ): Promise<SequenceResponse<SequenceEnrollment>> {
    let all = this.getAll()

    if (options?.templateId) {
      all = all.filter((e) => e.templateId === options.templateId)
    }
    if (options?.contactId) {
      all = all.filter((e) => e.contactId === options.contactId)
    }
    if (options?.leadId) {
      all = all.filter((e) => e.leadId === options.leadId)
    }
    if (options?.status) {
      all = all.filter((e) => e.status === options.status)
    }

    const skip = options?._skip ?? 0
    const limit = options?._limit ?? 100
    const paged = all.slice(skip, skip + limit)

    return {
      data: paged,
      has_more: skip + limit < all.length,
      total_results: all.length,
    }
  }

  async bulkEnroll(input: BulkEnrollInput): Promise<SequenceEnrollment[]> {
    const enrollments: SequenceEnrollment[] = []

    for (const contact of input.contacts) {
      try {
        const enrollment = await this.create({
          templateId: input.templateId,
          contactId: contact.contactId,
          leadId: contact.leadId,
          variables: contact.variables,
          enrolledBy: input.enrolledBy,
        })
        enrollments.push(enrollment)
      } catch (error) {
        // Skip already enrolled contacts
        if (error instanceof SequenceError && error.errorCode === 'ALREADY_ENROLLED') {
          continue
        }
        throw error
      }
    }

    return enrollments
  }

  async pause(id: string, reason?: string): Promise<SequenceEnrollment> {
    return this.update(id, { status: 'paused', pauseReason: reason })
  }

  async resume(id: string): Promise<SequenceEnrollment> {
    const existing = await this.get(id)
    if (!existing) {
      throw new SequenceError(`Enrollment not found: ${id}`, 'NOT_FOUND', 404)
    }

    if (existing.status !== 'paused') {
      throw new SequenceError(
        `Cannot resume enrollment with status: ${existing.status}`,
        'INVALID_STATUS',
        400
      )
    }

    // Calculate next step time from now
    const template = await this.templates.get(existing.templateId)
    if (!template) {
      throw new SequenceError(`Template not found: ${existing.templateId}`, 'TEMPLATE_NOT_FOUND', 404)
    }

    const currentStepDef = template.steps[existing.currentStep - 1]
    const nextStepAt = currentStepDef
      ? calculateNextStepTime(
          new Date(),
          0, // Resume immediately
          currentStepDef.skipWeekends ?? false,
          currentStepDef.sendTime,
          currentStepDef.timezone
        ).toISOString()
      : undefined

    const updated: SequenceEnrollment = {
      ...existing,
      status: 'active',
      pauseReason: undefined,
      nextStepAt,
      date_updated: now(),
    }

    this.storage.set(`${this.prefix}${id}`, updated)
    return updated
  }

  async stop(id: string): Promise<SequenceEnrollment> {
    return this.update(id, { status: 'stopped' })
  }

  /**
   * Execute the next step for an enrollment
   */
  async executeNextStep(id: string): Promise<StepExecutionResult> {
    const enrollment = await this.get(id)
    if (!enrollment) {
      throw new SequenceError(`Enrollment not found: ${id}`, 'NOT_FOUND', 404)
    }

    if (enrollment.status !== 'active') {
      throw new SequenceError(
        `Cannot execute step for enrollment with status: ${enrollment.status}`,
        'INVALID_STATUS',
        400
      )
    }

    const template = await this.templates.get(enrollment.templateId)
    if (!template) {
      throw new SequenceError(`Template not found: ${enrollment.templateId}`, 'TEMPLATE_NOT_FOUND', 404)
    }

    const currentStepDef = template.steps[enrollment.currentStep - 1]
    if (!currentStepDef) {
      // No more steps - mark as completed
      enrollment.status = 'completed'
      enrollment.completedAt = now()
      enrollment.nextStepAt = undefined
      enrollment.date_updated = now()
      this.storage.set(`${this.prefix}${id}`, enrollment)

      if (template.stats) {
        template.stats.activeEnrollments = Math.max(0, (template.stats.activeEnrollments ?? 1) - 1)
        template.stats.completedEnrollments = (template.stats.completedEnrollments ?? 0) + 1
        this.storage.set(`close:seqtemplate:${template.id}`, template)
      }

      return {
        enrollment,
        step: {
          step: enrollment.currentStep,
          type: 'wait',
          status: 'completed',
          scheduledAt: now(),
          executedAt: now(),
        },
      }
    }

    // Create step execution record
    const stepExecution: StepExecution = {
      step: enrollment.currentStep,
      type: currentStepDef.type,
      status: 'executing',
      scheduledAt: enrollment.nextStepAt ?? now(),
    }

    try {
      // Execute the step based on type
      const activityId = await this.executeStep(currentStepDef, enrollment, template)

      stepExecution.status = 'completed'
      stepExecution.executedAt = now()
      stepExecution.activityId = activityId

      // Update template stats
      if (template.stats) {
        switch (currentStepDef.type) {
          case 'email':
            template.stats.emailsSent = (template.stats.emailsSent ?? 0) + 1
            break
          case 'call':
            template.stats.callsMade = (template.stats.callsMade ?? 0) + 1
            break
          case 'sms':
            template.stats.smsSent = (template.stats.smsSent ?? 0) + 1
            break
          case 'linkedin':
            template.stats.linkedInActions = (template.stats.linkedInActions ?? 0) + 1
            break
        }
        this.storage.set(`close:seqtemplate:${template.id}`, template)
      }
    } catch (error) {
      stepExecution.status = 'failed'
      stepExecution.executedAt = now()
      stepExecution.error = error instanceof Error ? error.message : String(error)
    }

    // Add to step history
    enrollment.stepHistory.push(stepExecution)

    // Move to next step
    enrollment.currentStep++
    const nextStepDef = template.steps[enrollment.currentStep - 1]

    if (nextStepDef) {
      enrollment.nextStepAt = calculateNextStepTime(
        new Date(),
        nextStepDef.delay,
        nextStepDef.skipWeekends ?? false,
        nextStepDef.sendTime,
        nextStepDef.timezone
      ).toISOString()
    } else {
      // No more steps
      enrollment.status = 'completed'
      enrollment.completedAt = now()
      enrollment.nextStepAt = undefined

      if (template.stats) {
        template.stats.activeEnrollments = Math.max(0, (template.stats.activeEnrollments ?? 1) - 1)
        template.stats.completedEnrollments = (template.stats.completedEnrollments ?? 0) + 1
        this.storage.set(`close:seqtemplate:${template.id}`, template)
      }
    }

    enrollment.date_updated = now()
    this.storage.set(`${this.prefix}${id}`, enrollment)

    return {
      enrollment,
      step: stepExecution,
      activityId: stepExecution.activityId,
      nextStepAt: enrollment.nextStepAt,
    }
  }

  /**
   * Execute a specific step type
   */
  private async executeStep(
    step: SequenceStep,
    enrollment: SequenceEnrollment,
    template: SequenceTemplate
  ): Promise<string | undefined> {
    const activityId = generateId('acti')

    switch (step.type) {
      case 'email': {
        const emailStep = step as EmailStep
        // Interpolate variables
        const subject = interpolateVariables(emailStep.subject, enrollment.variables)
        const body = interpolateVariables(emailStep.body, enrollment.variables)

        // Create email activity record
        const emailActivity = {
          id: activityId,
          _type: 'Email',
          lead_id: enrollment.leadId,
          contact_id: enrollment.contactId,
          subject,
          body_text: body,
          body_html: emailStep.bodyHtml
            ? interpolateVariables(emailStep.bodyHtml, enrollment.variables)
            : undefined,
          direction: 'outgoing',
          status: 'sent',
          sequence_id: template.id,
          sequence_step: step.step,
          date_created: now(),
          date_updated: now(),
        }
        this.storage.set(`close:email:${activityId}`, emailActivity)
        return activityId
      }

      case 'call': {
        const callStep = step as CallStep
        const callActivity = {
          id: activityId,
          _type: 'Call',
          lead_id: enrollment.leadId,
          contact_id: enrollment.contactId,
          direction: 'outbound',
          note: callStep.note
            ? interpolateVariables(callStep.note, enrollment.variables)
            : undefined,
          duration: callStep.duration,
          sequence_id: template.id,
          sequence_step: step.step,
          date_created: now(),
          date_updated: now(),
        }
        this.storage.set(`close:call:${activityId}`, callActivity)
        return activityId
      }

      case 'sms': {
        const smsStep = step as SMSStep
        const smsActivity = {
          id: activityId,
          _type: 'SMS',
          lead_id: enrollment.leadId,
          contact_id: enrollment.contactId,
          direction: 'outbound',
          text: interpolateVariables(smsStep.text, enrollment.variables),
          status: 'sent',
          sequence_id: template.id,
          sequence_step: step.step,
          date_created: now(),
          date_updated: now(),
        }
        this.storage.set(`close:sms:${activityId}`, smsActivity)
        return activityId
      }

      case 'linkedin': {
        const linkedinStep = step as LinkedInStep
        const linkedinActivity = {
          id: activityId,
          _type: 'LinkedIn',
          lead_id: enrollment.leadId,
          contact_id: enrollment.contactId,
          action: linkedinStep.action,
          message: linkedinStep.message
            ? interpolateVariables(linkedinStep.message, enrollment.variables)
            : undefined,
          sequence_id: template.id,
          sequence_step: step.step,
          date_created: now(),
          date_updated: now(),
        }
        this.storage.set(`close:linkedin:${activityId}`, linkedinActivity)
        return activityId
      }

      case 'task': {
        const taskStep = step as TaskStep
        const task = {
          id: activityId,
          lead_id: enrollment.leadId,
          text: interpolateVariables(taskStep.text, enrollment.variables),
          assigned_to: taskStep.assignTo,
          is_complete: false,
          is_dateless: false,
          sequence_id: template.id,
          sequence_step: step.step,
          date_created: now(),
          date_updated: now(),
        }
        this.storage.set(`close:task:${activityId}`, task)
        return activityId
      }

      case 'wait':
        // No activity created for wait steps
        return undefined
    }
  }

  /**
   * Get enrollments that are due for execution
   */
  async getDueEnrollments(asOf?: Date): Promise<SequenceEnrollment[]> {
    const checkTime = (asOf ?? new Date()).toISOString()
    const all = this.getAll()

    return all.filter(
      (e) =>
        e.status === 'active' &&
        e.nextStepAt &&
        e.nextStepAt <= checkTime
    )
  }

  /**
   * Mark an enrollment as replied (exits sequence)
   */
  async markReplied(id: string): Promise<SequenceEnrollment> {
    return this.update(id, { status: 'replied' })
  }

  /**
   * Mark an enrollment as bounced (exits sequence)
   */
  async markBounced(id: string): Promise<SequenceEnrollment> {
    return this.update(id, { status: 'bounced' })
  }

  /**
   * Mark an enrollment as unsubscribed (exits sequence)
   */
  async markUnsubscribed(id: string): Promise<SequenceEnrollment> {
    return this.update(id, { status: 'unsubscribed' })
  }
}

// =============================================================================
// Main Client
// =============================================================================

export interface SequenceClientOptions {
  storage: Map<string, unknown> | CloseStorage
}

export class SequenceClient {
  private storage: CloseStorage

  readonly templates: TemplatesResource
  readonly enrollments: EnrollmentsResource

  constructor(options: SequenceClientOptions) {
    // Adapt Map to storage interface if needed
    if (options.storage instanceof Map) {
      this.storage = new MapStorageAdapter(options.storage)
    } else {
      this.storage = options.storage
    }

    // Initialize resources
    this.templates = new TemplatesResource(this.storage)
    this.enrollments = new EnrollmentsResource(this.storage, this.templates)
  }
}

// =============================================================================
// Exports
// =============================================================================

export default SequenceClient
