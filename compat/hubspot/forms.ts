/**
 * @dotdo/hubspot/forms - HubSpot Forms API Compatibility Layer
 *
 * Drop-in replacement for HubSpot Forms API with edge compatibility.
 * Provides form management, submissions handling, and form analytics.
 *
 * @example
 * ```typescript
 * import { HubSpotForms } from '@dotdo/hubspot/forms'
 *
 * const forms = new HubSpotForms(storage)
 *
 * // Create a form
 * const form = await forms.createForm({
 *   name: 'Contact Form',
 *   formType: 'hubspot',
 *   fieldGroups: [{
 *     groupType: 'default_group',
 *     fields: [
 *       { name: 'email', fieldType: 'text', required: true },
 *       { name: 'firstname', fieldType: 'text', required: false },
 *     ]
 *   }],
 *   submitButtonText: 'Submit',
 *   redirectUrl: '/thank-you',
 * })
 *
 * // Submit to form
 * await forms.submitForm(form.id, {
 *   fields: [
 *     { name: 'email', value: 'user@example.com' },
 *     { name: 'firstname', value: 'John' },
 *   ],
 *   context: {
 *     pageUri: 'https://example.com/contact',
 *     pageName: 'Contact Us',
 *   }
 * })
 * ```
 *
 * @module @dotdo/hubspot/forms
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Form type
 */
export type FormType = 'hubspot' | 'embedded' | 'standalone' | 'popup' | 'banner'

/**
 * Form state
 */
export type FormState = 'draft' | 'published' | 'archived'

/**
 * Field type options
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'booleancheckbox'
  | 'number'
  | 'file'
  | 'date'
  | 'phonenumber'

/**
 * Form field definition
 */
export interface FormField {
  name: string
  label: string
  fieldType: FieldType
  description?: string
  placeholder?: string
  defaultValue?: string
  required: boolean
  hidden: boolean
  validation?: FieldValidation
  dependentFieldFilters?: DependentFieldFilter[]
  options?: FieldOption[]
  objectTypeId?: string
  propertyName?: string
}

/**
 * Field validation rules
 */
export interface FieldValidation {
  name: string
  message?: string
  blocksFormSubmission: boolean
  data?: string
  useDefaultBlockList?: boolean
  minAllowedValue?: number
  maxAllowedValue?: number
  minLength?: number
  maxLength?: number
  regex?: string
}

/**
 * Dependent field filter
 */
export interface DependentFieldFilter {
  dependentFieldName: string
  dependentOperator: 'SET_ANY' | 'NOT_SET' | 'EQUAL' | 'NOT_EQUAL'
  dependentFieldValues?: string[]
}

/**
 * Field option for select/radio/checkbox
 */
export interface FieldOption {
  label: string
  value: string
  displayOrder: number
  hidden?: boolean
  description?: string
}

/**
 * Field group within a form
 */
export interface FieldGroup {
  groupType: 'default_group' | 'progressive' | 'dependent'
  richTextType?: 'TEXT' | 'HTML'
  richText?: string
  fields: FormField[]
}

/**
 * Form styling configuration
 */
export interface FormStyle {
  fontFamily?: string
  labelTextColor?: string
  helpTextColor?: string
  legalConsentTextColor?: string
  submitColor?: string
  submitFontColor?: string
  submitAlignment?: 'left' | 'center' | 'right'
  backgroundWidth?: 'content' | 'form'
  backgroundColor?: string
}

/**
 * Legal consent options
 */
export interface LegalConsentOptions {
  type: 'implicit' | 'legitimate_interest' | 'explicit'
  subscriptionTypeIds?: number[]
  lawfulBasis?: string
  privacyText?: string
  communicationConsentText?: string
  processingConsentText?: string
  processingConsentCheckboxLabel?: string
  communicationConsentCheckboxes?: Array<{
    subscriptionTypeId: number
    label: string
    required: boolean
  }>
}

/**
 * Form configuration
 */
export interface FormConfiguration {
  language?: string
  cloneable?: boolean
  postSubmitAction?: {
    type: 'redirect_url' | 'inline_message' | 'schedule_meeting'
    value?: string
    meetingLink?: string
  }
  editable?: boolean
  archivable?: boolean
  recaptchaEnabled?: boolean
  notifyRecipients?: string[]
  notifyOwner?: boolean
  createNewContactForNewEmail?: boolean
  prePopulateKnownValues?: boolean
  allowLinkToResetKnownValues?: boolean
  lifecycleStage?: string
}

/**
 * Form definition
 */
export interface Form {
  id: string
  name: string
  formType: FormType
  state: FormState
  fieldGroups: FieldGroup[]
  submitButtonText: string
  style?: FormStyle
  legalConsentOptions?: LegalConsentOptions
  configuration: FormConfiguration
  displayOptions?: {
    cssClass?: string
    submitButtonClass?: string
    renderRawHtml?: boolean
  }
  redirectUrl?: string
  inlineMessage?: string
  thankYouMessageJson?: string
  portalId?: number
  guid?: string
  version?: number
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt?: string
}

/**
 * Form submission field
 */
export interface SubmissionField {
  name: string
  value: string
  objectTypeId?: string
}

/**
 * Submission context
 */
export interface SubmissionContext {
  hutk?: string
  pageUri?: string
  pageName?: string
  pageId?: string
  ipAddress?: string
  timestamp?: string
  sfdcCampaignId?: string
  goToWebinarWebinarKey?: string
}

/**
 * Legal consent in submission
 */
export interface SubmissionLegalConsent {
  legitimateInterest?: {
    subscriptionTypeId: number
    value: boolean
    legalBasis: string
    text: string
  }
  consent?: {
    consentToProcess: boolean
    text: string
    communications?: Array<{
      subscriptionTypeId: number
      value: boolean
      text: string
    }>
  }
}

/**
 * Form submission input
 */
export interface FormSubmissionInput {
  fields: SubmissionField[]
  context?: SubmissionContext
  legalConsentOptions?: SubmissionLegalConsent
  skipValidation?: boolean
}

/**
 * Form submission result
 */
export interface FormSubmission {
  id: string
  formId: string
  submittedAt: string
  values: Record<string, string>
  pageUrl?: string
  pageName?: string
  ipAddress?: string
  contactId?: string
  conversionId?: string
}

/**
 * Submission result
 */
export interface SubmissionResult {
  redirectUri?: string
  inlineMessage?: string
  errors?: Array<{
    errorType: string
    message: string
    fieldName?: string
  }>
}

/**
 * Form create input
 */
export interface CreateFormInput {
  name: string
  formType?: FormType
  fieldGroups: FieldGroup[]
  submitButtonText?: string
  style?: FormStyle
  legalConsentOptions?: LegalConsentOptions
  configuration?: Partial<FormConfiguration>
  displayOptions?: Form['displayOptions']
  redirectUrl?: string
  inlineMessage?: string
}

/**
 * Form update input
 */
export interface UpdateFormInput {
  name?: string
  fieldGroups?: FieldGroup[]
  submitButtonText?: string
  style?: FormStyle
  legalConsentOptions?: LegalConsentOptions
  configuration?: Partial<FormConfiguration>
  displayOptions?: Form['displayOptions']
  redirectUrl?: string
  inlineMessage?: string
}

/**
 * List options
 */
export interface ListFormsOptions {
  limit?: number
  after?: string
  formTypes?: FormType[]
  state?: FormState
}

/**
 * List result
 */
export interface ListResult<T> {
  results: T[]
  paging?: {
    next?: { after: string }
  }
}

/**
 * Batch result
 */
export interface BatchResult<T> {
  status: 'COMPLETE' | 'PENDING' | 'PROCESSING'
  results: T[]
  errors: Array<{ status: string; message: string; context?: Record<string, unknown> }>
}

/**
 * Storage interface
 */
export interface FormsStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>
}

// =============================================================================
// Error Class
// =============================================================================

export class HubSpotFormsError extends Error {
  category: string
  statusCode: number
  correlationId: string
  context?: Record<string, unknown>

  constructor(
    message: string,
    category: string,
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HubSpotFormsError'
    this.category = category
    this.statusCode = statusCode
    this.correlationId = generateId('correlation')
    this.context = context
  }
}

// =============================================================================
// Utilities
// =============================================================================

function generateId(prefix: string = 'form'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${timestamp}${random}`
}

function now(): string {
  return new Date().toISOString()
}

// =============================================================================
// HubSpotForms Class
// =============================================================================

/**
 * HubSpot Forms compatibility layer with DO storage
 */
export class HubSpotForms {
  private storage: FormsStorage
  private onSubmission?: (submission: FormSubmission) => Promise<void>

  private readonly PREFIX = {
    form: 'form:',
    submission: 'submission:',
    formSubmissions: 'form_submissions:', // form_id -> submission_ids
  }

  constructor(storage: FormsStorage, onSubmission?: (submission: FormSubmission) => Promise<void>) {
    this.storage = storage
    this.onSubmission = onSubmission
  }

  // ===========================================================================
  // Forms CRUD
  // ===========================================================================

  /**
   * Create a new form
   */
  async createForm(input: CreateFormInput): Promise<Form> {
    const id = generateId('form')
    const timestamp = now()

    const form: Form = {
      id,
      name: input.name,
      formType: input.formType ?? 'hubspot',
      state: 'draft',
      fieldGroups: input.fieldGroups,
      submitButtonText: input.submitButtonText ?? 'Submit',
      style: input.style,
      legalConsentOptions: input.legalConsentOptions,
      configuration: {
        language: 'en',
        cloneable: true,
        editable: true,
        archivable: true,
        recaptchaEnabled: false,
        createNewContactForNewEmail: true,
        prePopulateKnownValues: true,
        allowLinkToResetKnownValues: false,
        ...input.configuration,
      },
      displayOptions: input.displayOptions,
      redirectUrl: input.redirectUrl,
      inlineMessage: input.inlineMessage,
      guid: id,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: false,
    }

    await this.storage.put(`${this.PREFIX.form}${id}`, form)
    return form
  }

  /**
   * Get a form by ID
   */
  async getForm(formId: string): Promise<Form> {
    const form = await this.storage.get<Form>(`${this.PREFIX.form}${formId}`)
    if (!form || form.archived) {
      throw new HubSpotFormsError(
        `Form not found: ${formId}`,
        'FORM_NOT_FOUND',
        404
      )
    }
    return form
  }

  /**
   * Update a form
   */
  async updateForm(formId: string, input: UpdateFormInput): Promise<Form> {
    const form = await this.getForm(formId)
    const timestamp = now()

    const updatedForm: Form = {
      ...form,
      ...input,
      configuration: {
        ...form.configuration,
        ...input.configuration,
      },
      version: (form.version ?? 0) + 1,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.form}${formId}`, updatedForm)
    return updatedForm
  }

  /**
   * Delete (archive) a form
   */
  async deleteForm(formId: string): Promise<void> {
    const form = await this.getForm(formId)
    const timestamp = now()

    const archivedForm: Form = {
      ...form,
      archived: true,
      archivedAt: timestamp,
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.form}${formId}`, archivedForm)
  }

  /**
   * Publish a form
   */
  async publishForm(formId: string): Promise<Form> {
    const form = await this.getForm(formId)
    const timestamp = now()

    const publishedForm: Form = {
      ...form,
      state: 'published',
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.form}${formId}`, publishedForm)
    return publishedForm
  }

  /**
   * Unpublish a form (set to draft)
   */
  async unpublishForm(formId: string): Promise<Form> {
    const form = await this.getForm(formId)
    const timestamp = now()

    const draftForm: Form = {
      ...form,
      state: 'draft',
      updatedAt: timestamp,
    }

    await this.storage.put(`${this.PREFIX.form}${formId}`, draftForm)
    return draftForm
  }

  /**
   * List all forms
   */
  async listForms(options?: ListFormsOptions): Promise<ListResult<Form>> {
    const formsMap = await this.storage.list({ prefix: this.PREFIX.form })
    const forms: Form[] = []

    for (const value of formsMap.values()) {
      const form = value as Form
      if (form.archived) continue
      if (options?.formTypes && !options.formTypes.includes(form.formType)) continue
      if (options?.state && form.state !== options.state) continue
      forms.push(form)
    }

    // Sort by createdAt descending
    forms.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = forms.findIndex((f) => f.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = forms.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < forms.length

    return {
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Clone a form
   */
  async cloneForm(formId: string, newName: string): Promise<Form> {
    const form = await this.getForm(formId)

    if (!form.configuration.cloneable) {
      throw new HubSpotFormsError(
        'Form is not cloneable',
        'FORM_NOT_CLONEABLE',
        400
      )
    }

    return this.createForm({
      name: newName,
      formType: form.formType,
      fieldGroups: form.fieldGroups,
      submitButtonText: form.submitButtonText,
      style: form.style,
      legalConsentOptions: form.legalConsentOptions,
      configuration: { ...form.configuration },
      displayOptions: form.displayOptions,
      redirectUrl: form.redirectUrl,
      inlineMessage: form.inlineMessage,
    })
  }

  // ===========================================================================
  // Form Submissions
  // ===========================================================================

  /**
   * Submit to a form
   */
  async submitForm(formId: string, input: FormSubmissionInput): Promise<SubmissionResult> {
    const form = await this.getForm(formId)

    // Validate fields if not skipped
    if (!input.skipValidation) {
      const errors = this.validateSubmission(form, input)
      if (errors.length > 0) {
        return { errors }
      }
    }

    // Create submission
    const submissionId = generateId('submission')
    const timestamp = now()

    const values: Record<string, string> = {}
    for (const field of input.fields) {
      values[field.name] = field.value
    }

    const submission: FormSubmission = {
      id: submissionId,
      formId,
      submittedAt: timestamp,
      values,
      pageUrl: input.context?.pageUri,
      pageName: input.context?.pageName,
      ipAddress: input.context?.ipAddress,
    }

    // Store submission
    await this.storage.put(`${this.PREFIX.submission}${submissionId}`, submission)

    // Update form submissions index
    const indexKey = `${this.PREFIX.formSubmissions}${formId}`
    const existingIndex = await this.storage.get<string[]>(indexKey) ?? []
    existingIndex.push(submissionId)
    await this.storage.put(indexKey, existingIndex)

    // Trigger callback if provided
    if (this.onSubmission) {
      await this.onSubmission(submission)
    }

    // Return result based on form configuration
    if (form.redirectUrl) {
      return { redirectUri: form.redirectUrl }
    }

    if (form.inlineMessage) {
      return { inlineMessage: form.inlineMessage }
    }

    return { inlineMessage: 'Thank you for your submission.' }
  }

  /**
   * Get a submission by ID
   */
  async getSubmission(submissionId: string): Promise<FormSubmission> {
    const submission = await this.storage.get<FormSubmission>(
      `${this.PREFIX.submission}${submissionId}`
    )
    if (!submission) {
      throw new HubSpotFormsError(
        `Submission not found: ${submissionId}`,
        'SUBMISSION_NOT_FOUND',
        404
      )
    }
    return submission
  }

  /**
   * List submissions for a form
   */
  async listSubmissions(
    formId: string,
    options?: { limit?: number; after?: string }
  ): Promise<ListResult<FormSubmission>> {
    const indexKey = `${this.PREFIX.formSubmissions}${formId}`
    const submissionIds = await this.storage.get<string[]>(indexKey) ?? []

    const submissions: FormSubmission[] = []
    for (const id of submissionIds) {
      const submission = await this.storage.get<FormSubmission>(
        `${this.PREFIX.submission}${id}`
      )
      if (submission) {
        submissions.push(submission)
      }
    }

    // Sort by submittedAt descending
    submissions.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

    // Pagination
    const limit = options?.limit ?? 100
    let startIndex = 0
    if (options?.after) {
      const afterIndex = submissions.findIndex((s) => s.id === options.after)
      if (afterIndex !== -1) {
        startIndex = afterIndex + 1
      }
    }

    const paged = submissions.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < submissions.length

    return {
      results: paged,
      paging: hasMore
        ? { next: { after: paged[paged.length - 1]?.id ?? '' } }
        : undefined,
    }
  }

  /**
   * Get submission count for a form
   */
  async getSubmissionCount(formId: string): Promise<number> {
    const indexKey = `${this.PREFIX.formSubmissions}${formId}`
    const submissionIds = await this.storage.get<string[]>(indexKey) ?? []
    return submissionIds.length
  }

  /**
   * Delete a submission
   */
  async deleteSubmission(submissionId: string): Promise<void> {
    const submission = await this.getSubmission(submissionId)

    // Remove from storage
    await this.storage.delete(`${this.PREFIX.submission}${submissionId}`)

    // Remove from form index
    const indexKey = `${this.PREFIX.formSubmissions}${submission.formId}`
    const existingIndex = await this.storage.get<string[]>(indexKey) ?? []
    const newIndex = existingIndex.filter((id) => id !== submissionId)
    await this.storage.put(indexKey, newIndex)
  }

  // ===========================================================================
  // Field Management
  // ===========================================================================

  /**
   * Add a field to a form
   */
  async addField(
    formId: string,
    groupIndex: number,
    field: FormField
  ): Promise<Form> {
    const form = await this.getForm(formId)

    if (groupIndex >= form.fieldGroups.length) {
      throw new HubSpotFormsError(
        `Field group not found at index: ${groupIndex}`,
        'FIELD_GROUP_NOT_FOUND',
        400
      )
    }

    // Check for duplicate field name
    for (const group of form.fieldGroups) {
      if (group.fields.some((f) => f.name === field.name)) {
        throw new HubSpotFormsError(
          `Field already exists: ${field.name}`,
          'DUPLICATE_FIELD',
          409
        )
      }
    }

    form.fieldGroups[groupIndex].fields.push(field)
    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  /**
   * Update a field in a form
   */
  async updateField(
    formId: string,
    fieldName: string,
    updates: Partial<FormField>
  ): Promise<Form> {
    const form = await this.getForm(formId)

    let found = false
    for (const group of form.fieldGroups) {
      const fieldIndex = group.fields.findIndex((f) => f.name === fieldName)
      if (fieldIndex !== -1) {
        group.fields[fieldIndex] = { ...group.fields[fieldIndex], ...updates }
        found = true
        break
      }
    }

    if (!found) {
      throw new HubSpotFormsError(
        `Field not found: ${fieldName}`,
        'FIELD_NOT_FOUND',
        404
      )
    }

    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  /**
   * Remove a field from a form
   */
  async removeField(formId: string, fieldName: string): Promise<Form> {
    const form = await this.getForm(formId)

    let found = false
    for (const group of form.fieldGroups) {
      const fieldIndex = group.fields.findIndex((f) => f.name === fieldName)
      if (fieldIndex !== -1) {
        group.fields.splice(fieldIndex, 1)
        found = true
        break
      }
    }

    if (!found) {
      throw new HubSpotFormsError(
        `Field not found: ${fieldName}`,
        'FIELD_NOT_FOUND',
        404
      )
    }

    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  /**
   * Reorder fields in a group
   */
  async reorderFields(
    formId: string,
    groupIndex: number,
    fieldNames: string[]
  ): Promise<Form> {
    const form = await this.getForm(formId)

    if (groupIndex >= form.fieldGroups.length) {
      throw new HubSpotFormsError(
        `Field group not found at index: ${groupIndex}`,
        'FIELD_GROUP_NOT_FOUND',
        400
      )
    }

    const group = form.fieldGroups[groupIndex]
    const fieldMap = new Map(group.fields.map((f) => [f.name, f]))

    const reorderedFields: FormField[] = []
    for (const name of fieldNames) {
      const field = fieldMap.get(name)
      if (!field) {
        throw new HubSpotFormsError(
          `Field not found: ${name}`,
          'FIELD_NOT_FOUND',
          404
        )
      }
      reorderedFields.push(field)
    }

    // Add any fields not in the reorder list at the end
    for (const field of group.fields) {
      if (!fieldNames.includes(field.name)) {
        reorderedFields.push(field)
      }
    }

    form.fieldGroups[groupIndex].fields = reorderedFields
    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  // ===========================================================================
  // Field Group Management
  // ===========================================================================

  /**
   * Add a field group to a form
   */
  async addFieldGroup(formId: string, group: FieldGroup): Promise<Form> {
    const form = await this.getForm(formId)
    form.fieldGroups.push(group)
    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  /**
   * Remove a field group from a form
   */
  async removeFieldGroup(formId: string, groupIndex: number): Promise<Form> {
    const form = await this.getForm(formId)

    if (groupIndex >= form.fieldGroups.length) {
      throw new HubSpotFormsError(
        `Field group not found at index: ${groupIndex}`,
        'FIELD_GROUP_NOT_FOUND',
        400
      )
    }

    if (form.fieldGroups.length <= 1) {
      throw new HubSpotFormsError(
        'Cannot remove the last field group',
        'CANNOT_REMOVE_LAST_GROUP',
        400
      )
    }

    form.fieldGroups.splice(groupIndex, 1)
    return this.updateForm(formId, { fieldGroups: form.fieldGroups })
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate a submission against form fields
   */
  private validateSubmission(
    form: Form,
    input: FormSubmissionInput
  ): Array<{ errorType: string; message: string; fieldName?: string }> {
    const errors: Array<{ errorType: string; message: string; fieldName?: string }> = []
    const submittedFields = new Map(input.fields.map((f) => [f.name, f.value]))

    for (const group of form.fieldGroups) {
      for (const field of group.fields) {
        const value = submittedFields.get(field.name)

        // Required field validation
        if (field.required && (!value || value.trim() === '')) {
          errors.push({
            errorType: 'REQUIRED_FIELD',
            message: `Field "${field.label}" is required`,
            fieldName: field.name,
          })
          continue
        }

        // Skip validation for empty optional fields
        if (!value || value.trim() === '') continue

        // Type-specific validation
        if (field.fieldType === 'phonenumber') {
          const phoneRegex = /^[\d\s+\-().]+$/
          if (!phoneRegex.test(value)) {
            errors.push({
              errorType: 'INVALID_PHONE',
              message: `Invalid phone number format for "${field.label}"`,
              fieldName: field.name,
            })
          }
        }

        if (field.fieldType === 'number') {
          if (isNaN(Number(value))) {
            errors.push({
              errorType: 'INVALID_NUMBER',
              message: `Invalid number format for "${field.label}"`,
              fieldName: field.name,
            })
          }
        }

        // Custom validation rules
        if (field.validation) {
          const validation = field.validation

          if (validation.minLength && value.length < validation.minLength) {
            errors.push({
              errorType: 'MIN_LENGTH',
              message: validation.message ?? `"${field.label}" must be at least ${validation.minLength} characters`,
              fieldName: field.name,
            })
          }

          if (validation.maxLength && value.length > validation.maxLength) {
            errors.push({
              errorType: 'MAX_LENGTH',
              message: validation.message ?? `"${field.label}" must be at most ${validation.maxLength} characters`,
              fieldName: field.name,
            })
          }

          if (validation.minAllowedValue !== undefined) {
            const numValue = Number(value)
            if (!isNaN(numValue) && numValue < validation.minAllowedValue) {
              errors.push({
                errorType: 'MIN_VALUE',
                message: validation.message ?? `"${field.label}" must be at least ${validation.minAllowedValue}`,
                fieldName: field.name,
              })
            }
          }

          if (validation.maxAllowedValue !== undefined) {
            const numValue = Number(value)
            if (!isNaN(numValue) && numValue > validation.maxAllowedValue) {
              errors.push({
                errorType: 'MAX_VALUE',
                message: validation.message ?? `"${field.label}" must be at most ${validation.maxAllowedValue}`,
                fieldName: field.name,
              })
            }
          }

          if (validation.regex) {
            const regex = new RegExp(validation.regex)
            if (!regex.test(value)) {
              errors.push({
                errorType: 'REGEX_MISMATCH',
                message: validation.message ?? `"${field.label}" does not match the required format`,
                fieldName: field.name,
              })
            }
          }
        }
      }
    }

    return errors
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get form statistics
   */
  async getFormStats(formId: string): Promise<{
    totalSubmissions: number
    submissionsLast24h: number
    submissionsLast7d: number
    submissionsLast30d: number
  }> {
    const submissions = await this.listSubmissions(formId, { limit: 10000 })
    const now = Date.now()

    let last24h = 0
    let last7d = 0
    let last30d = 0

    for (const submission of submissions.results) {
      const submittedAt = new Date(submission.submittedAt).getTime()
      const age = now - submittedAt

      if (age <= 24 * 60 * 60 * 1000) last24h++
      if (age <= 7 * 24 * 60 * 60 * 1000) last7d++
      if (age <= 30 * 24 * 60 * 60 * 1000) last30d++
    }

    return {
      totalSubmissions: submissions.results.length,
      submissionsLast24h: last24h,
      submissionsLast7d: last7d,
      submissionsLast30d: last30d,
    }
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Clear all forms and submissions (for testing)
   */
  async clear(): Promise<void> {
    const forms = await this.storage.list({ prefix: this.PREFIX.form })
    for (const key of forms.keys()) {
      await this.storage.delete(key as string)
    }

    const submissions = await this.storage.list({ prefix: this.PREFIX.submission })
    for (const key of submissions.keys()) {
      await this.storage.delete(key as string)
    }

    const indices = await this.storage.list({ prefix: this.PREFIX.formSubmissions })
    for (const key of indices.keys()) {
      await this.storage.delete(key as string)
    }
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotForms
