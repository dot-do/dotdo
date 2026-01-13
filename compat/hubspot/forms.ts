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

import type {
  Form,
  FormType,
  FormState,
  FormField,
  FormFieldType,
  FormFieldGroup,
  FormFieldValidation,
  FormStyle,
  FormLegalConsentOptions,
  FormConfiguration,
  FormSubmission,
  FormSubmissionInput,
  FormSubmissionResult,
  FormValidationError,
  CreateFormInput,
  UpdateFormInput,
  ListFormsOptions,
  FormListResult,
  FormsStorage,
  FormStats,
} from './types'

// Re-export types for backward compatibility
export type {
  Form,
  FormType,
  FormState,
  FormField,
  FormFieldGroup,
  FormSubmission,
  FormSubmissionInput,
  CreateFormInput,
  UpdateFormInput,
  ListFormsOptions,
  FormsStorage,
}

// Legacy type aliases for backward compatibility
export type FieldType = FormFieldType
export type FieldGroup = FormFieldGroup
export type FieldValidation = FormFieldValidation
export type FieldOption = import('./types').FormFieldOption
export type DependentFieldFilter = import('./types').FormDependentFieldFilter
export type LegalConsentOptions = FormLegalConsentOptions
export type SubmissionField = import('./types').FormSubmissionField
export type SubmissionContext = import('./types').FormSubmissionContext
export type SubmissionLegalConsent = import('./types').FormSubmissionLegalConsent
export type SubmissionResult = FormSubmissionResult
export type ListResult<T> = FormListResult<T>
export type BatchResult<T> = import('./types').FormBatchResult<T>

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
// Field Validators - Modular Validation System
// =============================================================================

/**
 * Validator function type
 */
type FieldValidator = (
  field: FormField,
  value: string | undefined,
) => FormValidationError | null

/**
 * Validate required fields
 */
const validateRequired: FieldValidator = (field, value) => {
  if (field.required && (!value || value.trim() === '')) {
    return {
      errorType: 'REQUIRED_FIELD',
      message: `Field "${field.label}" is required`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate email format
 */
const validateEmail: FieldValidator = (field, value) => {
  if (field.fieldType !== 'email' && field.fieldType !== 'text') return null
  if (!value || value.trim() === '') return null

  // Only validate if fieldType is email or field name suggests email
  const isEmailField = field.fieldType === 'email' ||
    field.name.toLowerCase().includes('email')

  if (!isEmailField) return null

  // RFC 5322 compliant email regex (simplified but thorough)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value)) {
    return {
      errorType: 'INVALID_EMAIL',
      message: `Invalid email format for "${field.label}"`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate phone number format
 */
const validatePhoneNumber: FieldValidator = (field, value) => {
  if (field.fieldType !== 'phonenumber') return null
  if (!value || value.trim() === '') return null

  const phoneRegex = /^[\d\s+\-().]+$/
  if (!phoneRegex.test(value)) {
    return {
      errorType: 'INVALID_PHONE',
      message: `Invalid phone number format for "${field.label}"`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate number format
 */
const validateNumber: FieldValidator = (field, value) => {
  if (field.fieldType !== 'number') return null
  if (!value || value.trim() === '') return null

  if (isNaN(Number(value))) {
    return {
      errorType: 'INVALID_NUMBER',
      message: `Invalid number format for "${field.label}"`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate minimum length
 */
const validateMinLength: FieldValidator = (field, value) => {
  if (!field.validation?.minLength) return null
  if (!value || value.trim() === '') return null

  if (value.length < field.validation.minLength) {
    return {
      errorType: 'MIN_LENGTH',
      message: field.validation.message ??
        `"${field.label}" must be at least ${field.validation.minLength} characters`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate maximum length
 */
const validateMaxLength: FieldValidator = (field, value) => {
  if (!field.validation?.maxLength) return null
  if (!value || value.trim() === '') return null

  if (value.length > field.validation.maxLength) {
    return {
      errorType: 'MAX_LENGTH',
      message: field.validation.message ??
        `"${field.label}" must be at most ${field.validation.maxLength} characters`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate minimum allowed value (for numbers)
 */
const validateMinValue: FieldValidator = (field, value) => {
  if (field.validation?.minAllowedValue === undefined) return null
  if (!value || value.trim() === '') return null

  const numValue = Number(value)
  if (!isNaN(numValue) && numValue < field.validation.minAllowedValue) {
    return {
      errorType: 'MIN_VALUE',
      message: field.validation.message ??
        `"${field.label}" must be at least ${field.validation.minAllowedValue}`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate maximum allowed value (for numbers)
 */
const validateMaxValue: FieldValidator = (field, value) => {
  if (field.validation?.maxAllowedValue === undefined) return null
  if (!value || value.trim() === '') return null

  const numValue = Number(value)
  if (!isNaN(numValue) && numValue > field.validation.maxAllowedValue) {
    return {
      errorType: 'MAX_VALUE',
      message: field.validation.message ??
        `"${field.label}" must be at most ${field.validation.maxAllowedValue}`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate regex pattern
 */
const validateRegex: FieldValidator = (field, value) => {
  if (!field.validation?.regex) return null
  if (!value || value.trim() === '') return null

  const regex = new RegExp(field.validation.regex)
  if (!regex.test(value)) {
    return {
      errorType: 'REGEX_MISMATCH',
      message: field.validation.message ??
        `"${field.label}" does not match the required format`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Validate select/radio options
 */
const validateOptions: FieldValidator = (field, value) => {
  if (!['select', 'radio'].includes(field.fieldType)) return null
  if (!value || value.trim() === '') return null
  if (!field.options || field.options.length === 0) return null

  const validValues = field.options
    .filter(opt => !opt.hidden)
    .map(opt => opt.value)

  if (!validValues.includes(value)) {
    return {
      errorType: 'INVALID_OPTION',
      message: `Invalid option selected for "${field.label}"`,
      fieldName: field.name,
    }
  }
  return null
}

/**
 * Default validators applied to all fields
 */
const DEFAULT_VALIDATORS: FieldValidator[] = [
  validateRequired,
  validateEmail,
  validatePhoneNumber,
  validateNumber,
  validateMinLength,
  validateMaxLength,
  validateMinValue,
  validateMaxValue,
  validateRegex,
  validateOptions,
]

/**
 * Form Validator class for modular field validation
 */
export class FormValidator {
  private validators: FieldValidator[]

  constructor(validators: FieldValidator[] = DEFAULT_VALIDATORS) {
    this.validators = validators
  }

  /**
   * Add a custom validator
   */
  addValidator(validator: FieldValidator): void {
    this.validators.push(validator)
  }

  /**
   * Validate a single field
   */
  validateField(field: FormField, value: string | undefined): FormValidationError[] {
    const errors: FormValidationError[] = []

    for (const validator of this.validators) {
      const error = validator(field, value)
      if (error) {
        errors.push(error)
        // Stop on first error for this field (required check should fail fast)
        if (error.errorType === 'REQUIRED_FIELD') break
      }
    }

    return errors
  }

  /**
   * Validate all fields in a form submission
   */
  validateSubmission(
    form: Form,
    input: FormSubmissionInput
  ): FormValidationError[] {
    const errors: FormValidationError[] = []
    const submittedFields = new Map(input.fields.map(f => [f.name, f.value]))

    for (const group of form.fieldGroups) {
      for (const field of group.fields) {
        // Skip hidden fields
        if (field.hidden) continue

        const value = submittedFields.get(field.name)
        const fieldErrors = this.validateField(field, value)
        errors.push(...fieldErrors)
      }
    }

    return errors
  }
}

// Default form validator instance
const defaultValidator = new FormValidator()

// =============================================================================
// HubSpotForms Class
// =============================================================================

/**
 * HubSpot Forms compatibility layer with DO storage
 */
export class HubSpotForms {
  private storage: FormsStorage
  private onSubmission?: (submission: FormSubmission) => Promise<void>
  private validator: FormValidator

  private readonly PREFIX = {
    form: 'form:',
    submission: 'submission:',
    formSubmissions: 'form_submissions:', // form_id -> submission_ids
  }

  constructor(
    storage: FormsStorage,
    onSubmission?: (submission: FormSubmission) => Promise<void>,
    validator: FormValidator = defaultValidator
  ) {
    this.storage = storage
    this.onSubmission = onSubmission
    this.validator = validator
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
  async listForms(options?: ListFormsOptions): Promise<FormListResult<Form>> {
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
  async submitForm(formId: string, input: FormSubmissionInput): Promise<FormSubmissionResult> {
    const form = await this.getForm(formId)

    // Validate fields if not skipped
    if (!input.skipValidation) {
      const errors = this.validator.validateSubmission(form, input)
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
  ): Promise<FormListResult<FormSubmission>> {
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
  async addFieldGroup(formId: string, group: FormFieldGroup): Promise<Form> {
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
  // Statistics
  // ===========================================================================

  /**
   * Get form statistics
   */
  async getFormStats(formId: string): Promise<FormStats> {
    const submissions = await this.listSubmissions(formId, { limit: 10000 })
    const currentTime = Date.now()

    let last24h = 0
    let last7d = 0
    let last30d = 0

    for (const submission of submissions.results) {
      const submittedAt = new Date(submission.submittedAt).getTime()
      const age = currentTime - submittedAt

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

  /**
   * Get the validator instance for customization
   */
  getValidator(): FormValidator {
    return this.validator
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default HubSpotForms
