/**
 * FormEngine Types
 *
 * Schema-driven form builder with validation, conditional logic,
 * file uploads, and payment integration.
 */

// ============================================================================
// FIELD TYPES
// ============================================================================

/**
 * All supported field types in the form engine
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'signature'
  | 'payment'
  | 'rating'
  | 'slider'
  | 'hidden'
  | 'group'

/**
 * Option for select/radio/checkbox fields
 */
export interface FieldOption {
  value: string | number
  label: string
  disabled?: boolean
  description?: string
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Built-in validation rule types
 */
export type ValidationRuleType =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'pattern'
  | 'email'
  | 'url'
  | 'phone'
  | 'date'
  | 'integer'
  | 'decimal'
  | 'custom'

/**
 * Validation rule configuration
 */
export interface ValidationRule {
  type: ValidationRuleType
  message?: string
  /** Value for rules that need parameters (min, max, pattern, etc.) */
  value?: string | number | RegExp
  /** Custom validation function (for 'custom' type) */
  validate?: (value: unknown, field: FormField, context: FormContext) => boolean | Promise<boolean>
  /** Whether this is an async validation */
  async?: boolean
}

/**
 * Field validation error
 */
export interface FieldError {
  field: string
  rule: ValidationRuleType
  message: string
  value?: unknown
}

/**
 * Form-level validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: FieldError[]
  warnings?: FieldError[]
}

// ============================================================================
// CONDITIONAL LOGIC
// ============================================================================

/**
 * Comparison operators for conditions
 */
export type ComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEquals'
  | 'lessThanOrEquals'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'matches'
  | 'in'
  | 'notIn'

/**
 * Single condition definition
 */
export interface Condition {
  field: string
  operator: ComparisonOperator
  value?: unknown
}

/**
 * Condition group with logical operators
 */
export interface ConditionGroup {
  logic: 'and' | 'or'
  conditions: (Condition | ConditionGroup)[]
}

/**
 * Action to perform when conditions are met
 */
export type ConditionAction =
  | 'show'
  | 'hide'
  | 'enable'
  | 'disable'
  | 'require'
  | 'optional'
  | 'setValue'
  | 'skipToStep'
  | 'skipToEnd'

/**
 * Conditional logic rule
 */
export interface ConditionalRule {
  /** Conditions that trigger this rule */
  when: Condition | ConditionGroup
  /** Action to perform */
  action: ConditionAction
  /** Target field(s) or step - if omitted, applies to the field that defines the rule */
  target?: string | string[]
  /** Value for setValue action */
  value?: unknown
  /** Step index for skipToStep action */
  step?: number
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

/**
 * File upload configuration
 */
export interface FileUploadConfig {
  /** Maximum file size in bytes */
  maxSize?: number
  /** Minimum file size in bytes */
  minSize?: number
  /** Allowed MIME types (e.g., ['image/png', 'image/jpeg']) */
  accept?: string[]
  /** Maximum number of files (for multiple uploads) */
  maxFiles?: number
  /** Minimum number of files */
  minFiles?: number
  /** Whether multiple files are allowed */
  multiple?: boolean
  /** Generate image previews */
  preview?: boolean
  /** Auto-upload when files are selected */
  autoUpload?: boolean
  /** Chunk size for large file uploads */
  chunkSize?: number
}

/**
 * Uploaded file metadata
 */
export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  url?: string
  thumbnailUrl?: string
  uploadedAt: Date
  progress?: number
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * File upload progress event
 */
export interface FileUploadProgress {
  fileId: string
  fileName: string
  loaded: number
  total: number
  progress: number
}

// ============================================================================
// PAYMENT
// ============================================================================

/**
 * Payment field configuration
 */
export interface PaymentConfig {
  /** Amount in cents */
  amount?: number
  /** Currency code (e.g., 'usd') */
  currency?: string
  /** Payment providers to enable */
  providers?: ('stripe' | 'paypal' | 'apple_pay' | 'google_pay')[]
  /** Whether this is a recurring payment */
  recurring?: boolean
  /** Recurring interval */
  interval?: 'day' | 'week' | 'month' | 'year'
  /** Description shown on payment */
  description?: string
  /** Metadata to attach to payment */
  metadata?: Record<string, unknown>
}

/**
 * Payment result
 */
export interface PaymentResult {
  success: boolean
  transactionId?: string
  amount?: number
  currency?: string
  error?: string
  provider?: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// FORM FIELD DEFINITION
// ============================================================================

/**
 * Base field properties shared by all field types
 */
export interface BaseField {
  /** Unique field identifier */
  id: string
  /** Field type */
  type: FieldType
  /** Display label */
  label: string
  /** Field name (for form data) */
  name?: string
  /** Placeholder text */
  placeholder?: string
  /** Help text shown below the field */
  helpText?: string
  /** Default value */
  defaultValue?: unknown
  /** Whether the field is required */
  required?: boolean
  /** Whether the field is disabled */
  disabled?: boolean
  /** Whether the field is read-only */
  readOnly?: boolean
  /** Whether the field is hidden */
  hidden?: boolean
  /** Validation rules */
  validation?: ValidationRule[]
  /** Conditional logic rules */
  conditions?: ConditionalRule[]
  /** Custom CSS classes */
  className?: string
  /** Custom inline styles */
  style?: Record<string, string | number>
  /** Accessibility label */
  ariaLabel?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Text-based field (text, textarea, email, url, phone)
 */
export interface TextField extends BaseField {
  type: 'text' | 'textarea' | 'email' | 'url' | 'phone'
  minLength?: number
  maxLength?: number
  pattern?: string
  autocomplete?: string
  rows?: number // for textarea
}

/**
 * Number field
 */
export interface NumberField extends BaseField {
  type: 'number'
  min?: number
  max?: number
  step?: number
  precision?: number
}

/**
 * Date/time fields
 */
export interface DateTimeField extends BaseField {
  type: 'date' | 'time' | 'datetime'
  min?: string
  max?: string
  format?: string
}

/**
 * Select/dropdown field
 */
export interface SelectField extends BaseField {
  type: 'select' | 'multiselect'
  options: FieldOption[]
  searchable?: boolean
  clearable?: boolean
  creatable?: boolean
}

/**
 * Checkbox field (single or group)
 */
export interface CheckboxField extends BaseField {
  type: 'checkbox'
  options?: FieldOption[]
  inline?: boolean
}

/**
 * Radio button group
 */
export interface RadioField extends BaseField {
  type: 'radio'
  options: FieldOption[]
  inline?: boolean
}

/**
 * File upload field
 */
export interface FileField extends BaseField {
  type: 'file'
  upload: FileUploadConfig
}

/**
 * Signature field
 */
export interface SignatureField extends BaseField {
  type: 'signature'
  width?: number
  height?: number
  penColor?: string
  backgroundColor?: string
}

/**
 * Payment field
 */
export interface PaymentField extends BaseField {
  type: 'payment'
  payment: PaymentConfig
}

/**
 * Rating field (stars, etc.)
 */
export interface RatingField extends BaseField {
  type: 'rating'
  maxRating?: number
  allowHalf?: boolean
  icon?: 'star' | 'heart' | 'circle'
}

/**
 * Slider field
 */
export interface SliderField extends BaseField {
  type: 'slider'
  min: number
  max: number
  step?: number
  showValue?: boolean
  marks?: Array<{ value: number; label: string }>
}

/**
 * Hidden field
 */
export interface HiddenField extends BaseField {
  type: 'hidden'
}

/**
 * Field group (for nested/grouped fields)
 */
export interface GroupField extends BaseField {
  type: 'group'
  fields: FormField[]
  layout?: 'vertical' | 'horizontal' | 'grid'
  columns?: number
}

/**
 * Union type for all field types
 */
export type FormField =
  | TextField
  | NumberField
  | DateTimeField
  | SelectField
  | CheckboxField
  | RadioField
  | FileField
  | SignatureField
  | PaymentField
  | RatingField
  | SliderField
  | HiddenField
  | GroupField

// ============================================================================
// FORM STEP (for multi-step forms)
// ============================================================================

/**
 * Form step configuration
 */
export interface FormStep {
  /** Step identifier */
  id: string
  /** Step title */
  title: string
  /** Step description */
  description?: string
  /** Fields in this step */
  fields: FormField[]
  /** Conditional rules for showing/skipping this step */
  conditions?: ConditionalRule[]
  /** Whether this step can be skipped */
  optional?: boolean
  /** Custom validation before proceeding to next step */
  beforeNext?: (data: FormData, context: FormContext) => boolean | Promise<boolean>
}

// ============================================================================
// FORM SCHEMA
// ============================================================================

/**
 * Complete form schema definition
 */
export interface FormSchema {
  /** Unique form identifier */
  id: string
  /** Form title */
  title: string
  /** Form description */
  description?: string
  /** Form version */
  version?: string
  /** Fields (for single-step forms) */
  fields?: FormField[]
  /** Steps (for multi-step forms) */
  steps?: FormStep[]
  /** Form-level settings */
  settings?: FormSettings
  /** Form-level conditional rules */
  conditions?: ConditionalRule[]
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

/**
 * Form settings
 */
export interface FormSettings {
  /** Submit button text */
  submitText?: string
  /** Show progress indicator */
  showProgress?: boolean
  /** Progress indicator type */
  progressType?: 'bar' | 'steps' | 'percentage'
  /** Allow saving draft */
  allowDraft?: boolean
  /** Auto-save interval in seconds */
  autoSaveInterval?: number
  /** Redirect URL after submission */
  redirectUrl?: string
  /** Confirmation message */
  confirmationMessage?: string
  /** Enable analytics tracking */
  analytics?: boolean
  /** Custom CSS */
  customCss?: string
  /** Theme */
  theme?: 'light' | 'dark' | 'auto'
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

/**
 * Form submission status
 */
export type SubmissionStatus = 'draft' | 'partial' | 'submitted' | 'processing' | 'completed' | 'failed'

/**
 * Form submission data
 */
export interface FormSubmission {
  /** Submission ID */
  id: string
  /** Form ID */
  formId: string
  /** Form version at submission time */
  formVersion?: string
  /** Submission status */
  status: SubmissionStatus
  /** Form data */
  data: FormData
  /** Current step (for partial submissions) */
  currentStep?: number
  /** Completed steps */
  completedSteps?: string[]
  /** File attachments */
  files?: UploadedFile[]
  /** Payment results */
  payments?: PaymentResult[]
  /** Validation errors */
  errors?: FieldError[]
  /** Submission metadata */
  metadata?: Record<string, unknown>
  /** Created timestamp */
  createdAt: Date
  /** Updated timestamp */
  updatedAt: Date
  /** Completed timestamp */
  completedAt?: Date
  /** IP address */
  ipAddress?: string
  /** User agent */
  userAgent?: string
  /** User ID (if authenticated) */
  userId?: string
}

/**
 * Form data (key-value pairs)
 */
export type FormData = Record<string, unknown>

// ============================================================================
// FORM CONTEXT
// ============================================================================

/**
 * Runtime context for form processing
 */
export interface FormContext {
  /** Current form data */
  data: FormData
  /** Form schema */
  schema: FormSchema
  /** Current step index */
  currentStep: number
  /** Field visibility state */
  visibility: Record<string, boolean>
  /** Field enabled state */
  enabled: Record<string, boolean>
  /** Field required state */
  required: Record<string, boolean>
  /** Validation errors */
  errors: FieldError[]
  /** Whether form is submitting */
  isSubmitting: boolean
  /** Whether form is valid */
  isValid: boolean
  /** Custom context data */
  custom?: Record<string, unknown>
}

// ============================================================================
// FORM ANALYTICS
// ============================================================================

/**
 * Field interaction event
 */
export interface FieldInteraction {
  field: string
  type: 'focus' | 'blur' | 'change' | 'error'
  timestamp: Date
  value?: unknown
  duration?: number
}

/**
 * Form analytics data
 */
export interface FormAnalytics {
  /** Form ID */
  formId: string
  /** Total views */
  views: number
  /** Total starts (at least one field filled) */
  starts: number
  /** Total submissions */
  submissions: number
  /** Completion rate (submissions/starts) */
  completionRate: number
  /** Average completion time in seconds */
  avgCompletionTime: number
  /** Drop-off by step */
  dropOffByStep: Record<string, number>
  /** Drop-off by field */
  dropOffByField: Record<string, number>
  /** Average time per field */
  avgTimePerField: Record<string, number>
  /** Error rate by field */
  errorRateByField: Record<string, number>
  /** Submission funnel */
  funnel: Array<{ step: string; count: number; dropOff: number }>
}

/**
 * Submission analytics event
 */
export interface SubmissionEvent {
  /** Event type */
  type: 'view' | 'start' | 'step_complete' | 'field_error' | 'submit' | 'complete' | 'abandon'
  /** Form ID */
  formId: string
  /** Submission ID */
  submissionId?: string
  /** Step ID */
  stepId?: string
  /** Field ID */
  fieldId?: string
  /** Timestamp */
  timestamp: Date
  /** Event metadata */
  metadata?: Record<string, unknown>
}
