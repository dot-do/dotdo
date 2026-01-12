/**
 * EmailTemplater Types - Comprehensive Email Templating Primitives
 *
 * Provides types for a complete email templating system:
 * - EmailTemplate: Template definition with subject, html, text, and variables
 * - TemplateVariable: Variable metadata with type, required flag, and default
 * - RenderedEmail: Final rendered email ready for sending
 * - TemplateContext: Rendering context with variables and locale
 * - Attachment: Email attachment with filename and content
 * - LocaleConfig: Internationalization configuration
 */

/**
 * Supported variable types for template variables
 */
export type VariableType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object'

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable name */
  name: string
  /** Variable type */
  type: VariableType
  /** Whether the variable is required */
  required: boolean
  /** Default value if not provided */
  default?: unknown
  /** Description for documentation */
  description?: string
}

/**
 * Email template definition
 */
export interface EmailTemplate {
  /** Unique template identifier */
  id: string
  /** Human-readable template name */
  name: string
  /** Email subject (supports variable substitution) */
  subject: string
  /** HTML template body */
  html: string
  /** Plain text template body (optional, can be auto-generated from HTML) */
  text?: string
  /** Variable definitions for this template */
  variables: TemplateVariable[]
  /** Template metadata */
  metadata?: Record<string, unknown>
  /** Default locale for this template */
  defaultLocale?: string
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

/**
 * Email attachment
 */
export interface Attachment {
  /** Attachment filename */
  filename: string
  /** Attachment content (base64 encoded or Buffer) */
  content: string | Buffer
  /** MIME content type */
  contentType: string
  /** Content-ID for inline attachments (cid:) */
  cid?: string
  /** Content disposition (attachment or inline) */
  disposition?: 'attachment' | 'inline'
}

/**
 * Rendered email ready for sending
 */
export interface RenderedEmail {
  /** Recipient email address(es) */
  to: string | string[]
  /** Sender email address */
  from: string
  /** Rendered email subject */
  subject: string
  /** Rendered HTML body */
  html: string
  /** Rendered plain text body */
  text: string
  /** Email attachments */
  attachments?: Attachment[]
  /** CC recipients */
  cc?: string | string[]
  /** BCC recipients */
  bcc?: string | string[]
  /** Reply-To address */
  replyTo?: string
  /** Custom headers */
  headers?: Record<string, string>
}

/**
 * Template rendering context
 */
export interface TemplateContext {
  /** Variables for template substitution */
  variables: Record<string, unknown>
  /** Locale for internationalization */
  locale?: string
  /** Timezone for date formatting */
  timezone?: string
  /** Additional context data */
  data?: Record<string, unknown>
}

/**
 * Email configuration for sending
 */
export interface EmailConfig {
  /** Default from address */
  from: string
  /** Default reply-to address */
  replyTo?: string
  /** Default custom headers */
  headers?: Record<string, string>
  /** Base URL for asset references */
  baseUrl?: string
  /** Default attachments */
  defaultAttachments?: Attachment[]
}

/**
 * Translation entry for a specific locale
 */
export interface TranslationEntry {
  /** Translated subject */
  subject?: string
  /** Translated HTML body */
  html?: string
  /** Translated text body */
  text?: string
  /** Translated variable labels */
  variableLabels?: Record<string, string>
}

/**
 * Locale configuration for internationalization
 */
export interface LocaleConfig {
  /** Current locale code (e.g., 'en-US', 'fr-FR') */
  locale: string
  /** Fallback locale if translation not found */
  fallback: string
  /** Translations by locale code */
  translations: Record<string, TranslationEntry>
  /** Date format by locale */
  dateFormats?: Record<string, string>
  /** Number format by locale */
  numberFormats?: Record<string, Intl.NumberFormatOptions>
}

/**
 * Validation result for template variables
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Validation errors */
  errors: ValidationError[]
  /** Warnings (non-blocking issues) */
  warnings: ValidationWarning[]
}

/**
 * Validation error detail
 */
export interface ValidationError {
  /** Variable name that failed validation */
  variable: string
  /** Error message */
  message: string
  /** Error code for programmatic handling */
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'VALIDATION_FAILED'
  /** Expected type */
  expected?: VariableType
  /** Received type */
  received?: string
}

/**
 * Validation warning detail
 */
export interface ValidationWarning {
  /** Variable name */
  variable: string
  /** Warning message */
  message: string
  /** Warning code */
  code: 'UNUSED_VARIABLE' | 'DEPRECATED' | 'TYPE_COERCED'
}

/**
 * Preview result for email template
 */
export interface PreviewResult {
  /** Rendered email content */
  rendered: RenderedEmail
  /** Validation result */
  validation: ValidationResult
  /** Estimated email size in bytes */
  sizeBytes: number
  /** Preview mode indicator */
  isPreview: true
  /** Preview timestamp */
  previewedAt: Date
}

/**
 * Template list item (minimal info for listing)
 */
export interface TemplateListItem {
  /** Template ID */
  id: string
  /** Template name */
  name: string
  /** Number of variables */
  variableCount: number
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

/**
 * Helper function definition for template processing
 */
export interface TemplateHelper {
  /** Helper name */
  name: string
  /** Helper function */
  fn: (value: unknown, ...args: unknown[]) => unknown
  /** Description */
  description?: string
}

/**
 * Filter function definition for template processing
 */
export interface TemplateFilter {
  /** Filter name */
  name: string
  /** Filter function */
  fn: (value: unknown, ...args: unknown[]) => unknown
  /** Description */
  description?: string
}

/**
 * Template engine configuration
 */
export interface TemplateEngineConfig {
  /** Opening delimiter for variables (default: '{{') */
  openDelimiter?: string
  /** Closing delimiter for variables (default: '}}') */
  closeDelimiter?: string
  /** Whether to escape HTML by default */
  escapeHtml?: boolean
  /** Whether to throw on missing variables */
  throwOnMissing?: boolean
  /** Custom helpers */
  helpers?: TemplateHelper[]
  /** Custom filters */
  filters?: TemplateFilter[]
}

/**
 * Conditional block definition
 */
export interface ConditionalBlock {
  /** Condition expression */
  condition: string
  /** Content if condition is true */
  ifTrue: string
  /** Content if condition is false (optional) */
  ifFalse?: string
}

/**
 * Loop block definition
 */
export interface LoopBlock {
  /** Array variable name */
  array: string
  /** Iterator variable name */
  iterator: string
  /** Loop body content */
  body: string
}

/**
 * Email templater interface
 */
export interface IEmailTemplater {
  /**
   * Register a new email template
   * @param template Template to register
   */
  register(template: EmailTemplate): Promise<void>

  /**
   * Render a template with context
   * @param templateId Template ID
   * @param context Rendering context
   * @param config Optional email config
   * @returns Rendered email
   */
  render(templateId: string, context: TemplateContext, config?: EmailConfig): Promise<RenderedEmail>

  /**
   * Validate variables against template requirements
   * @param templateId Template ID
   * @param variables Variables to validate
   * @returns Validation result
   */
  validate(templateId: string, variables: Record<string, unknown>): Promise<ValidationResult>

  /**
   * Preview a template without sending
   * @param templateId Template ID
   * @param context Rendering context
   * @param config Optional email config
   * @returns Preview result
   */
  preview(templateId: string, context: TemplateContext, config?: EmailConfig): Promise<PreviewResult>

  /**
   * List all registered templates
   * @returns Template list
   */
  list(): Promise<TemplateListItem[]>

  /**
   * Get a template by ID
   * @param templateId Template ID
   * @returns Template or null
   */
  get(templateId: string): Promise<EmailTemplate | null>

  /**
   * Delete a template
   * @param templateId Template ID
   */
  delete(templateId: string): Promise<void>
}

/**
 * Template engine interface for variable substitution
 */
export interface ITemplateEngine {
  /**
   * Render a template string with variables
   * @param template Template string
   * @param variables Variables for substitution
   * @returns Rendered string
   */
  render(template: string, variables: Record<string, unknown>): string

  /**
   * Extract variable names from template
   * @param template Template string
   * @returns Variable names found in template
   */
  extractVariables(template: string): string[]

  /**
   * Register a custom helper
   * @param helper Helper to register
   */
  registerHelper(helper: TemplateHelper): void

  /**
   * Register a custom filter
   * @param filter Filter to register
   */
  registerFilter(filter: TemplateFilter): void
}

/**
 * HTML processor interface
 */
export interface IHTMLProcessor {
  /**
   * Process HTML template
   * @param html HTML content
   * @returns Processed HTML
   */
  process(html: string): string

  /**
   * Inline CSS styles into HTML elements
   * @param html HTML with style tags
   * @returns HTML with inline styles
   */
  inlineStyles(html: string): string

  /**
   * Sanitize HTML for email clients
   * @param html HTML content
   * @returns Sanitized HTML
   */
  sanitize(html: string): string
}

/**
 * Text generator interface for HTML to plain text conversion
 */
export interface ITextGenerator {
  /**
   * Convert HTML to plain text
   * @param html HTML content
   * @returns Plain text version
   */
  generate(html: string): string
}

/**
 * Localization manager interface
 */
export interface ILocalizationManager {
  /**
   * Get translated content for a locale
   * @param templateId Template ID
   * @param locale Locale code
   * @returns Translated entry or null
   */
  getTranslation(templateId: string, locale: string): TranslationEntry | null

  /**
   * Add translation for a template
   * @param templateId Template ID
   * @param locale Locale code
   * @param translation Translation entry
   */
  addTranslation(templateId: string, locale: string, translation: TranslationEntry): void

  /**
   * Format a date for a locale
   * @param date Date to format
   * @param locale Locale code
   * @param format Optional format string
   * @returns Formatted date string
   */
  formatDate(date: Date, locale: string, format?: string): string

  /**
   * Format a number for a locale
   * @param number Number to format
   * @param locale Locale code
   * @param options Format options
   * @returns Formatted number string
   */
  formatNumber(number: number, locale: string, options?: Intl.NumberFormatOptions): string
}

/**
 * Attachment handler interface
 */
export interface IAttachmentHandler {
  /**
   * Add attachment to email
   * @param attachment Attachment to add
   * @returns Processed attachment
   */
  add(attachment: Attachment): Attachment

  /**
   * Validate attachment
   * @param attachment Attachment to validate
   * @returns Whether attachment is valid
   */
  validate(attachment: Attachment): boolean

  /**
   * Get total size of attachments
   * @param attachments Attachments to measure
   * @returns Total size in bytes
   */
  getTotalSize(attachments: Attachment[]): number
}

/**
 * Variable validator interface
 */
export interface IVariableValidator {
  /**
   * Validate a value against a variable definition
   * @param value Value to validate
   * @param variable Variable definition
   * @returns Validation result
   */
  validate(value: unknown, variable: TemplateVariable): ValidationError | null

  /**
   * Check if value matches expected type
   * @param value Value to check
   * @param expectedType Expected type
   * @returns Whether type matches
   */
  checkType(value: unknown, expectedType: VariableType): boolean

  /**
   * Coerce value to expected type if possible
   * @param value Value to coerce
   * @param targetType Target type
   * @returns Coerced value
   */
  coerce(value: unknown, targetType: VariableType): unknown
}
