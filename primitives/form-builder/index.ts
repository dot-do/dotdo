/**
 * FormBuilder Primitive for dotdo
 *
 * A comprehensive form building system supporting:
 * - Declarative form schema definition
 * - Field-level and form-level validation
 * - Conditional field visibility and enablement
 * - Multi-step forms with progress tracking
 * - File upload handling with security
 * - Schema versioning and migration
 * - Analytics and completion tracking
 *
 * @module primitives/form-builder
 */

export * from './types'

import type {
  FormSchema,
  FormField,
  FormLayout,
  FormMetadata,
  FormStep,
  ValidationResult,
  ValidationRule,
  ComplexCondition,
  SimpleCondition,
  FormSubmission,
  SubmissionMetadata,
  FileUploadOptions,
  FileInfo,
  FileUploadResult,
  VersionDiff,
  FormStats,
  FieldStats,
  DropOffPoint,
} from './types'

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generates a unique ID with a given prefix
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// ============================================================================
// FormBuilder - Build form schemas declaratively
// ============================================================================

/**
 * Fluent builder for creating form schemas
 *
 * @example
 * ```ts
 * const builder = new FormBuilder()
 * builder.addField({ name: 'email', type: 'email', label: 'Email' })
 * builder.setLayout({ columns: 2 })
 * const schema = builder.build()
 * ```
 */
export class FormBuilder {
  private fields: FormField[] = []
  private layout: FormLayout = { columns: 1 }
  private metadata: FormMetadata = {}
  private steps?: FormStep[]

  /**
   * Deserialize a JSON string into a FormSchema
   */
  static fromJSON(json: string): FormSchema {
    const parsed = JSON.parse(json)
    return {
      id: parsed.id,
      name: parsed.name,
      version: parsed.version,
      description: parsed.description,
      fields: parsed.fields || [],
      layout: parsed.layout || { columns: 1 },
      steps: parsed.steps,
    }
  }

  /**
   * Add a field to the form
   */
  addField(field: FormField): this {
    this.fields.push({ ...field })
    return this
  }

  /**
   * Remove a field by name
   * @throws Error if field not found
   */
  removeField(name: string): this {
    const index = this.findFieldIndex(name)
    this.fields.splice(index, 1)
    return this
  }

  /**
   * Update an existing field's properties
   * @throws Error if field not found
   */
  updateField(name: string, updates: Partial<FormField>): this {
    const index = this.findFieldIndex(name)
    this.fields[index] = { ...this.fields[index], ...updates }
    return this
  }

  /**
   * Reorder fields according to the provided name order
   */
  reorderFields(order: string[]): this {
    const reordered: FormField[] = []
    for (const name of order) {
      const field = this.fields.find((f) => f.name === name)
      if (field) {
        reordered.push(field)
      }
    }
    this.fields = reordered
    return this
  }

  /**
   * Configure the form layout
   */
  setLayout(layout: FormLayout): this {
    this.layout = { ...this.layout, ...layout }
    return this
  }

  /**
   * Set form metadata (id, name, version, etc.)
   */
  setMetadata(metadata: FormMetadata): this {
    this.metadata = { ...this.metadata, ...metadata }
    return this
  }

  /**
   * Configure multi-step form progression
   * @throws Error if any step references a non-existent field
   */
  setSteps(steps: FormStep[]): this {
    for (const step of steps) {
      for (const fieldName of step.fields) {
        this.findFieldIndex(fieldName) // Throws if not found
      }
    }
    this.steps = steps
    return this
  }

  /**
   * Build the final immutable form schema
   */
  build(): FormSchema {
    return {
      id: this.metadata.id || 'form',
      name: this.metadata.name || 'Untitled Form',
      version: this.metadata.version || '1.0.0',
      description: this.metadata.description,
      fields: [...this.fields],
      layout: { ...this.layout },
      steps: this.steps ? [...this.steps] : undefined,
    }
  }

  private findFieldIndex(name: string): number {
    const index = this.fields.findIndex((f) => f.name === name)
    if (index === -1) {
      throw new Error(`Field "${name}" not found`)
    }
    return index
  }
}

// ============================================================================
// FormValidator - Validate form submissions against schema
// ============================================================================

/**
 * Validates form data against a schema's validation rules
 *
 * @example
 * ```ts
 * const validator = new FormValidator(schema)
 * const result = validator.validate({ email: 'test@example.com' })
 * if (!result.valid) {
 *   console.log(result.errors)
 * }
 * ```
 */
export class FormValidator {
  private schema: FormSchema
  private fieldMap: Map<string, FormField>

  constructor(schema: FormSchema) {
    this.schema = schema
    this.fieldMap = new Map(schema.fields.map((f) => [f.name, f]))
  }

  /**
   * Validate all fields in the form data
   */
  validate(data: Record<string, unknown>): ValidationResult {
    const errors: Record<string, string> = {}

    for (const field of this.schema.fields) {
      const error = this.validateFieldValue(field, data[field.name])
      if (error) {
        errors[field.name] = error
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    }
  }

  /**
   * Validate a single field
   * @returns Error message or null if valid
   */
  validateField(name: string, value: unknown): string | null {
    const field = this.fieldMap.get(name)
    if (!field) {
      return `Field "${name}" not found`
    }
    return this.validateFieldValue(field, value)
  }

  private validateFieldValue(field: FormField, value: unknown): string | null {
    if (!field.validation) {
      return null
    }

    for (const rule of field.validation) {
      const error = this.applyRule(rule, value)
      if (error) {
        return error
      }
    }

    return null
  }

  private applyRule(rule: ValidationRule, value: unknown): string | null {
    switch (rule.type) {
      case 'required':
        return this.validateRequired(value, rule.message)

      case 'pattern':
        return this.validatePattern(value, rule.pattern, rule.message)

      case 'min':
        return this.validateMin(value, rule.value, rule.message)

      case 'max':
        return this.validateMax(value, rule.value, rule.message)

      case 'minLength':
        return this.validateMinLength(value, rule.value, rule.message)

      case 'maxLength':
        return this.validateMaxLength(value, rule.value, rule.message)

      case 'custom':
        return rule.validator?.(value) || null
    }

    return null
  }

  private validateRequired(value: unknown, message?: string): string | null {
    if (value === null || value === undefined || value === '') {
      return message || 'This field is required'
    }
    return null
  }

  private validatePattern(value: unknown, pattern?: string, message?: string): string | null {
    if (pattern && typeof value === 'string') {
      const regex = new RegExp(pattern)
      if (!regex.test(value)) {
        return message || 'Invalid format'
      }
    }
    return null
  }

  private validateMin(value: unknown, min?: number, message?: string): string | null {
    if (typeof value === 'number' && min !== undefined && value < min) {
      return message || `Value must be at least ${min}`
    }
    return null
  }

  private validateMax(value: unknown, max?: number, message?: string): string | null {
    if (typeof value === 'number' && max !== undefined && value > max) {
      return message || `Value must be at most ${max}`
    }
    return null
  }

  private validateMinLength(value: unknown, minLen?: number, message?: string): string | null {
    if (typeof value === 'string' && minLen !== undefined && value.length < minLen) {
      return message || `Must be at least ${minLen} characters`
    }
    return null
  }

  private validateMaxLength(value: unknown, maxLen?: number, message?: string): string | null {
    if (typeof value === 'string' && maxLen !== undefined && value.length > maxLen) {
      return message || `Must be at most ${maxLen} characters`
    }
    return null
  }
}

// ============================================================================
// ConditionalRenderer - Evaluate show/hide/enable conditions
// ============================================================================

/**
 * Evaluates conditional logic to determine field visibility and state
 *
 * @example
 * ```ts
 * const renderer = new ConditionalRenderer()
 * const visibleFields = renderer.getVisibleFields(schema.fields, formData)
 * ```
 */
export class ConditionalRenderer {
  /**
   * Determine if a field should be visible based on its conditions
   */
  isVisible(field: FormField, data: Record<string, unknown>): boolean {
    if (!field.conditionalLogic) {
      return true
    }

    const { showIf, hideIf } = field.conditionalLogic

    // hideIf takes precedence
    if (hideIf && this.evaluateCondition(hideIf, data)) {
      return false
    }

    // showIf - if defined, must be true
    if (showIf) {
      return this.evaluateCondition(showIf, data)
    }

    return true
  }

  /**
   * Determine if a field should be enabled based on its conditions
   */
  isEnabled(field: FormField, data: Record<string, unknown>): boolean {
    if (!field.conditionalLogic?.enableIf) {
      return true
    }

    return this.evaluateCondition(field.conditionalLogic.enableIf, data)
  }

  /**
   * Filter fields to only those that should be visible
   */
  getVisibleFields(fields: FormField[], data: Record<string, unknown>): FormField[] {
    return fields.filter((field) => this.isVisible(field, data))
  }

  private evaluateCondition(condition: ComplexCondition, data: Record<string, unknown>): boolean {
    // Handle AND conditions
    if (condition.and) {
      return condition.and.every((c) => this.evaluateSimpleCondition(c, data))
    }

    // Handle OR conditions
    if (condition.or) {
      return condition.or.some((c) => this.evaluateSimpleCondition(c, data))
    }

    // Handle simple condition
    return this.evaluateSimpleCondition(condition as SimpleCondition, data)
  }

  private evaluateSimpleCondition(condition: SimpleCondition, data: Record<string, unknown>): boolean {
    const value = data[condition.field]

    if (condition.equals !== undefined) {
      return value === condition.equals
    }

    if (condition.notEquals !== undefined) {
      return value !== condition.notEquals
    }

    if (condition.greaterThan !== undefined) {
      return typeof value === 'number' && value > condition.greaterThan
    }

    if (condition.lessThan !== undefined) {
      return typeof value === 'number' && value < condition.lessThan
    }

    if (condition.contains !== undefined) {
      return typeof value === 'string' && value.includes(condition.contains)
    }

    return false
  }
}

// ============================================================================
// FormSubmissionHandler - Process form submissions
// ============================================================================

type BeforeSubmitHook = (data: Record<string, unknown>) => Promise<Record<string, unknown>>
type AfterSubmitHook = (submission: FormSubmission) => Promise<void>

/**
 * Handles form submission processing with validation and hooks
 *
 * @example
 * ```ts
 * const handler = new FormSubmissionHandler()
 * handler.onBeforeSubmit(async (data) => ({ ...data, timestamp: Date.now() }))
 * const submission = await handler.submit(schema, formData)
 * ```
 */
export class FormSubmissionHandler {
  private submissions: Map<string, FormSubmission> = new Map()
  private beforeHooks: BeforeSubmitHook[] = []
  private afterHooks: AfterSubmitHook[] = []

  /**
   * Process and store a form submission
   * @throws Error if validation fails or beforeSubmit hook rejects
   */
  async submit(
    schema: FormSchema,
    data: Record<string, unknown>,
    metadata?: Partial<SubmissionMetadata>
  ): Promise<FormSubmission> {
    // Run before hooks
    let processedData = { ...data }
    for (const hook of this.beforeHooks) {
      processedData = await hook(processedData)
    }

    // Validate
    const validator = new FormValidator(schema)
    const result = validator.validate(processedData)
    if (!result.valid) {
      throw new Error('Validation failed: ' + JSON.stringify(result.errors))
    }

    // Sanitize - only keep fields defined in schema, trim strings
    const sanitized = this.sanitizeData(schema.fields, processedData)

    // Create submission
    const submission: FormSubmission = {
      id: generateId('sub'),
      formId: schema.id,
      data: sanitized,
      timestamp: new Date(),
      metadata: {
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
        referrer: metadata?.referrer,
        duration: metadata?.duration,
      },
    }

    // Store submission
    this.submissions.set(submission.id, submission)

    // Run after hooks
    for (const hook of this.afterHooks) {
      await hook(submission)
    }

    return submission
  }

  /**
   * Retrieve a submission by ID
   */
  async getSubmission(id: string): Promise<FormSubmission | undefined> {
    return this.submissions.get(id)
  }

  /**
   * List all submissions for a form
   */
  async listSubmissions(formId: string): Promise<FormSubmission[]> {
    return Array.from(this.submissions.values()).filter((s) => s.formId === formId)
  }

  /**
   * Register a hook to run before submission (can modify data)
   */
  onBeforeSubmit(hook: BeforeSubmitHook): void {
    this.beforeHooks.push(hook)
  }

  /**
   * Register a hook to run after successful submission
   */
  onAfterSubmit(hook: AfterSubmitHook): void {
    this.afterHooks.push(hook)
  }

  private sanitizeData(fields: FormField[], data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {}
    for (const field of fields) {
      const value = data[field.name]
      if (typeof value === 'string') {
        sanitized[field.name] = value.trim()
      } else if (value !== undefined) {
        sanitized[field.name] = value
      }
    }
    return sanitized
  }
}

// ============================================================================
// FileUploadHandler - Handle file field uploads
// ============================================================================

interface StoredFile extends FileInfo {
  id: string
  url: string
  uploadedAt: Date
}

/**
 * Handles file uploads with validation and security
 *
 * @example
 * ```ts
 * const handler = new FileUploadHandler({
 *   maxSize: 5 * 1024 * 1024,
 *   allowedTypes: ['image/jpeg', 'application/pdf']
 * })
 * const result = await handler.upload(file)
 * ```
 */
export class FileUploadHandler {
  private options: FileUploadOptions
  private files: Map<string, StoredFile> = new Map()

  constructor(options: FileUploadOptions) {
    this.options = options
  }

  /**
   * Upload a single file
   * @throws Error if file exceeds size limit or type not allowed
   */
  async upload(file: FileInfo): Promise<FileUploadResult> {
    this.validateFile(file)

    const id = generateId('file')
    const sanitizedFilename = this.sanitizeFilename(file.name)

    const storedFile: StoredFile = {
      ...file,
      name: file.name,
      id,
      url: `/files/${id}/${sanitizedFilename}`,
      uploadedAt: new Date(),
    }
    this.files.set(id, storedFile)

    return {
      success: true,
      id,
      url: storedFile.url,
      filename: sanitizedFilename,
    }
  }

  /**
   * Upload multiple files, returning results for each
   */
  async uploadMultiple(files: FileInfo[]): Promise<FileUploadResult[]> {
    const results: FileUploadResult[] = []
    for (const file of files) {
      try {
        const result = await this.upload(file)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed',
        })
      }
    }
    return results
  }

  /**
   * Retrieve a stored file by ID
   */
  async getFile(id: string): Promise<StoredFile | undefined> {
    return this.files.get(id)
  }

  /**
   * Delete a stored file
   */
  async delete(id: string): Promise<void> {
    this.files.delete(id)
  }

  private validateFile(file: FileInfo): void {
    if (file.size > this.options.maxSize) {
      throw new Error('File size exceeds maximum')
    }

    if (!this.options.allowedTypes.includes(file.type)) {
      throw new Error('File type not allowed')
    }
  }

  private sanitizeFilename(filename: string): string {
    // Remove path traversal attempts
    const basename = filename.split('/').pop()?.split('\\').pop() || filename
    // Keep only safe characters
    const sanitized = basename.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    // Preserve extension
    const lastDot = sanitized.lastIndexOf('.')
    if (lastDot > 0) {
      const name = sanitized.substring(0, lastDot)
      const ext = sanitized.substring(lastDot + 1)
      return `${name.substring(0, 50)}.${ext}`
    }
    return sanitized.substring(0, 50)
  }
}

// ============================================================================
// FormVersioning - Schema versioning and migrations
// ============================================================================

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>

/**
 * Manages form schema versions and data migrations
 *
 * @example
 * ```ts
 * const versioning = new FormVersioning()
 * await versioning.saveVersion(schema)
 * const latest = await versioning.getLatestVersion('contact-form')
 * ```
 */
export class FormVersioning {
  private versions: Map<string, Map<string, FormSchema>> = new Map()
  private migrations: Map<string, MigrationFn> = new Map()

  /**
   * Save a schema version
   */
  async saveVersion(schema: FormSchema): Promise<void> {
    let formVersions = this.versions.get(schema.id)
    if (!formVersions) {
      formVersions = new Map()
      this.versions.set(schema.id, formVersions)
    }
    formVersions.set(schema.version, { ...schema })
  }

  /**
   * Retrieve a specific schema version
   */
  async getVersion(formId: string, version: string): Promise<FormSchema | undefined> {
    return this.versions.get(formId)?.get(version)
  }

  /**
   * Get the most recent schema version (by semver)
   */
  async getLatestVersion(formId: string): Promise<FormSchema | undefined> {
    const formVersions = this.versions.get(formId)
    if (!formVersions || formVersions.size === 0) {
      return undefined
    }

    const versions = Array.from(formVersions.keys()).sort(this.compareSemver)
    return formVersions.get(versions[0])
  }

  /**
   * List all versions for a form
   */
  async listVersions(formId: string): Promise<string[]> {
    const formVersions = this.versions.get(formId)
    return formVersions ? Array.from(formVersions.keys()) : []
  }

  /**
   * Compare two schema versions and return differences
   */
  async diff(formId: string, v1: string, v2: string): Promise<VersionDiff> {
    const schema1 = await this.getVersion(formId, v1)
    const schema2 = await this.getVersion(formId, v2)

    if (!schema1 || !schema2) {
      throw new Error('Version not found')
    }

    const fields1 = new Map(schema1.fields.map((f) => [f.name, f]))
    const fields2 = new Map(schema2.fields.map((f) => [f.name, f]))

    const added: string[] = []
    const removed: string[] = []
    const modified: string[] = []

    // Find added and modified fields
    for (const [name, field] of fields2) {
      if (!fields1.has(name)) {
        added.push(name)
      } else {
        const oldField = fields1.get(name)!
        if (JSON.stringify(oldField) !== JSON.stringify(field)) {
          modified.push(name)
        }
      }
    }

    // Find removed fields
    for (const name of fields1.keys()) {
      if (!fields2.has(name)) {
        removed.push(name)
      }
    }

    return { added, removed, modified }
  }

  /**
   * Register a migration function between versions
   */
  registerMigration(formId: string, from: string, to: string, fn: MigrationFn): void {
    const key = `${formId}:${from}:${to}`
    this.migrations.set(key, fn)
  }

  /**
   * Migrate data from one schema version to another
   * @throws Error if no migration is registered
   */
  async migrateData(
    formId: string,
    from: string,
    to: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const key = `${formId}:${from}:${to}`
    const fn = this.migrations.get(key)

    if (!fn) {
      throw new Error(`No migration registered from ${from} to ${to}`)
    }

    return fn(data)
  }

  private compareSemver(a: string, b: string): number {
    const aParts = a.split('.').map(Number)
    const bParts = b.split('.').map(Number)
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (bParts[i] || 0) - (aParts[i] || 0)
      if (diff !== 0) return diff
    }
    return 0
  }
}

// ============================================================================
// FormAnalytics - Track completion rates, drop-offs
// ============================================================================

type EventType = 'view' | 'start' | 'interaction' | 'completion' | 'abandonment' | 'error'

interface AnalyticsEvent {
  type: EventType
  formId: string
  field?: string
  userId?: string
  timestamp: Date
  duration?: number
  lastField?: string
  error?: string
}

/**
 * Tracks form analytics including views, completions, and drop-offs
 *
 * @example
 * ```ts
 * const analytics = new FormAnalytics()
 * analytics.trackStart('contact-form', { userId: 'user-123' })
 * analytics.trackCompletion('contact-form', { userId: 'user-123', duration: 30000 })
 * console.log(analytics.getCompletionRate('contact-form'))
 * ```
 */
export class FormAnalytics {
  private events: AnalyticsEvent[] = []

  /**
   * Track a form view (page load)
   */
  trackView(formId: string, context?: { userId?: string; timestamp?: Date }): void {
    this.addEvent('view', formId, context)
  }

  /**
   * Track when user starts filling the form
   */
  trackStart(formId: string, context?: { userId?: string; timestamp?: Date }): void {
    this.addEvent('start', formId, context)
  }

  /**
   * Track field interaction (focus, change)
   */
  trackFieldInteraction(formId: string, field: string, context?: { userId?: string; timestamp?: Date }): void {
    this.addEvent('interaction', formId, { ...context, field })
  }

  /**
   * Track successful form completion
   */
  trackCompletion(formId: string, context?: { userId?: string; duration?: number; timestamp?: Date }): void {
    this.addEvent('completion', formId, context)
  }

  /**
   * Track form abandonment
   */
  trackAbandonment(formId: string, context?: { userId?: string; lastField?: string; timestamp?: Date }): void {
    this.addEvent('abandonment', formId, context)
  }

  /**
   * Track field validation error
   */
  trackFieldError(formId: string, field: string, error: string): void {
    this.addEvent('error', formId, { field, error })
  }

  /**
   * Get aggregate stats for a form
   */
  getStats(formId: string): FormStats {
    const formEvents = this.getFormEvents(formId)
    return this.computeStats(formEvents)
  }

  /**
   * Get stats for a specific field
   */
  getFieldStats(formId: string, field: string): FieldStats {
    const fieldEvents = this.events.filter((e) => e.formId === formId && e.field === field)
    return {
      interactions: fieldEvents.filter((e) => e.type === 'interaction').length,
      errors: fieldEvents.filter((e) => e.type === 'error').length,
      avgTimeSpent: 0,
    }
  }

  /**
   * Calculate completion rate (completions / starts)
   */
  getCompletionRate(formId: string): number {
    const stats = this.getStats(formId)
    return stats.starts === 0 ? 0 : stats.completions / stats.starts
  }

  /**
   * Identify where users abandon the form
   */
  getDropOffPoints(formId: string): DropOffPoint[] {
    const abandonments = this.events.filter((e) => e.formId === formId && e.type === 'abandonment')

    const dropOffCounts = new Map<string, number>()
    for (const event of abandonments) {
      if (event.lastField) {
        dropOffCounts.set(event.lastField, (dropOffCounts.get(event.lastField) || 0) + 1)
      }
    }

    const total = abandonments.length || 1
    return Array.from(dropOffCounts.entries()).map(([field, count]) => ({
      field,
      count,
      percentage: count / total,
    }))
  }

  /**
   * Calculate average time to complete the form
   */
  getAverageCompletionTime(formId: string): number {
    const completions = this.events.filter(
      (e) => e.formId === formId && e.type === 'completion' && e.duration !== undefined
    )

    if (completions.length === 0) {
      return 0
    }

    const totalDuration = completions.reduce((sum, e) => sum + (e.duration || 0), 0)
    return totalDuration / completions.length
  }

  /**
   * Get error counts by field
   */
  getFieldErrorStats(formId: string): Record<string, number> {
    const errors = this.events.filter((e) => e.formId === formId && e.type === 'error')

    const errorCounts: Record<string, number> = {}
    for (const event of errors) {
      if (event.field) {
        errorCounts[event.field] = (errorCounts[event.field] || 0) + 1
      }
    }

    return errorCounts
  }

  /**
   * Get stats filtered by date range
   */
  getStatsForDateRange(formId: string, start: Date, end: Date): FormStats {
    const formEvents = this.events.filter(
      (e) => e.formId === formId && e.timestamp >= start && e.timestamp <= end
    )
    return this.computeStats(formEvents)
  }

  private addEvent(
    type: EventType,
    formId: string,
    context?: {
      userId?: string
      timestamp?: Date
      field?: string
      duration?: number
      lastField?: string
      error?: string
    }
  ): void {
    this.events.push({
      type,
      formId,
      userId: context?.userId,
      field: context?.field,
      duration: context?.duration,
      lastField: context?.lastField,
      error: context?.error,
      timestamp: context?.timestamp || new Date(),
    })
  }

  private getFormEvents(formId: string): AnalyticsEvent[] {
    return this.events.filter((e) => e.formId === formId)
  }

  private computeStats(events: AnalyticsEvent[]): FormStats {
    return {
      views: events.filter((e) => e.type === 'view').length,
      starts: events.filter((e) => e.type === 'start').length,
      completions: events.filter((e) => e.type === 'completion').length,
      abandonments: events.filter((e) => e.type === 'abandonment').length,
    }
  }
}
