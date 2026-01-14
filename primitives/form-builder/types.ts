// FormBuilder Types - TDD RED phase stubs

export type FieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'file'
  | 'textarea'
  | 'rich-text'

export interface FieldOption {
  value: string
  label: string
}

export interface SimpleCondition {
  field: string
  equals?: unknown
  notEquals?: unknown
  greaterThan?: number
  lessThan?: number
  contains?: string
}

export interface ComplexCondition {
  and?: SimpleCondition[]
  or?: SimpleCondition[]
  field?: string
  equals?: unknown
  notEquals?: unknown
  greaterThan?: number
  lessThan?: number
  contains?: string
}

export interface ConditionalLogic {
  showIf?: ComplexCondition
  hideIf?: ComplexCondition
  enableIf?: ComplexCondition
}

export interface ValidationRule {
  type: 'required' | 'pattern' | 'min' | 'max' | 'minLength' | 'maxLength' | 'custom'
  message?: string
  pattern?: string
  value?: number
  validator?: (value: unknown) => string | null
}

export interface FormField {
  name: string
  type: FieldType
  label: string
  placeholder?: string
  defaultValue?: unknown
  options?: FieldOption[]
  validation?: ValidationRule[]
  conditionalLogic?: ConditionalLogic
  accept?: string
  maxSize?: number
  rows?: number
}

export interface FormSection {
  title: string
  description?: string
  fields: string[]
}

export interface FormStep {
  title: string
  description?: string
  fields: string[]
}

export interface FormLayout {
  columns?: number
  sections?: FormSection[]
  ordering?: string[]
}

export interface FormMetadata {
  id?: string
  name?: string
  version?: string
  description?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface FormSchema {
  id: string
  name: string
  version: string
  description?: string
  fields: FormField[]
  layout: FormLayout
  steps?: FormStep[]
  submission?: FormSubmissionConfig
}

export interface FormSubmissionConfig {
  endpoint?: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
}

export interface FormSubmission {
  id: string
  formId: string
  data: Record<string, unknown>
  timestamp: Date
  metadata?: SubmissionMetadata
}

export interface SubmissionMetadata {
  ip?: string
  userAgent?: string
  referrer?: string
  duration?: number
}

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
}

export interface FileUploadOptions {
  maxSize: number
  allowedTypes: string[]
  destination?: string
}

export interface FileInfo {
  name: string
  type: string
  size: number
  data: Uint8Array
}

export interface FileUploadResult {
  success: boolean
  id?: string
  url?: string
  filename?: string
  error?: string
}

export interface VersionDiff {
  added: string[]
  removed: string[]
  modified: string[]
}

export interface FormStats {
  views: number
  starts: number
  completions: number
  abandonments: number
}

export interface FieldStats {
  interactions: number
  errors: number
  avgTimeSpent: number
}

export interface DropOffPoint {
  field: string
  count: number
  percentage: number
}
