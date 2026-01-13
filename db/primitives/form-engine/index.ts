/**
 * FormEngine - Schema-driven form builder with validation, conditional logic,
 * file uploads, and payment integration
 *
 * Features:
 * - Form Schema Definition - Define forms with all field types
 * - Field Validation - Sync/async validation with custom validators
 * - Conditional Logic - Show/hide, enable/disable, require/optional based on conditions
 * - File Upload - Type/size validation, chunked uploads, progress tracking
 * - Multi-step Forms - Wizard navigation with step conditions
 * - Submission Storage - Partial saves, draft recovery
 * - Analytics - Completion rates, drop-off analysis, time tracking
 */

// Types
export * from './types'

// Schema
export {
  createFormSchema,
  defineField,
  defineStep,
  FormSchemaBuilder,
  validateFormSchema,
  parseFormSchema,
  getAllFields,
  getFieldById,
  getStepFields,
} from './schema'

// Validation
export {
  FormValidator,
  createValidator,
  validate,
} from './validation'

export type { ValidatorOptions, ValidationContext } from './validation'

// Conditional Logic
export {
  ConditionalEvaluator,
  createConditionEvaluator,
  evaluateConditions,
} from './conditional'

export type { ConditionEvaluationResult, EvaluationOptions } from './conditional'

// File Upload
export {
  FileValidator,
  createFileValidator,
  validateFile,
  validateFiles,
} from './file-upload'

export type { FileValidationResult, MultiFileValidationResult, FileChunk } from './file-upload'

// Submission Storage
export {
  SubmissionStore,
  createSubmissionStore,
} from './submission'

export type {
  CreateSubmissionInput,
  UpdateSubmissionInput,
  SubmissionQuery,
  SubmitOptions,
  GetOptions,
  DeleteOptions,
  SubmissionStoreOptions,
  SubmissionEventType,
  Submission,
} from './submission'

// Wizard
export {
  FormWizard,
  createWizard,
} from './wizard'

export type {
  WizardState,
  StepInfo,
  StepNavigation,
  StepCompleteEvent,
  WizardCompleteEvent,
  WizardOptions,
  SubmitResult,
} from './wizard'

// Analytics
export {
  FormAnalytics,
  AnalyticsCollector,
  createAnalytics,
} from './analytics'

export type {
  AnalyticsStats,
  FieldStats,
  StepStats,
  FunnelStep,
  ProblematicField,
  AnalyticsReport,
  ReportOptions,
  AnalyticsOptions,
  CollectorOptions,
} from './analytics'
