/**
 * DocumentRenderer Types - PDF Generation and Document Processing Primitives
 *
 * Provides types for a complete document rendering system:
 * - DocumentTemplate: Template definition with layout, sections, and merge fields
 * - PDFOptions: PDF generation settings (page size, margins, headers/footers)
 * - RenderedDocument: Final rendered document ready for delivery
 * - SignatureField: E-signature field placement and configuration
 * - DocumentMetadata: Document properties and audit trail
 *
 * Designed for Cloudflare Workers runtime compatibility.
 */

// =============================================================================
// Basic Types
// =============================================================================

/**
 * Supported document output formats
 */
export type DocumentFormat = 'pdf' | 'html' | 'png' | 'jpeg'

/**
 * Page size presets
 */
export type PageSize = 'letter' | 'legal' | 'a4' | 'a3' | 'custom'

/**
 * Page orientation
 */
export type PageOrientation = 'portrait' | 'landscape'

/**
 * Signature field types
 */
export type SignatureFieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox'

/**
 * Document status in signing workflow
 */
export type SigningStatus = 'draft' | 'sent' | 'viewed' | 'partially_signed' | 'completed' | 'declined' | 'voided' | 'expired'

/**
 * Variable types for template merge fields
 */
export type VariableType = 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'array' | 'object' | 'image'

// =============================================================================
// Page and Layout Types
// =============================================================================

/**
 * Page dimensions in points (1 inch = 72 points)
 */
export interface PageDimensions {
  /** Width in points */
  width: number
  /** Height in points */
  height: number
}

/**
 * Page margins in points
 */
export interface PageMargins {
  /** Top margin in points */
  top: number
  /** Right margin in points */
  right: number
  /** Bottom margin in points */
  bottom: number
  /** Left margin in points */
  left: number
}

/**
 * Position on a page
 */
export interface Position {
  /** X coordinate from left in points */
  x: number
  /** Y coordinate from top in points */
  y: number
  /** Page number (1-indexed) */
  page?: number
}

/**
 * Rectangular bounds
 */
export interface Bounds {
  /** X coordinate from left */
  x: number
  /** Y coordinate from top */
  y: number
  /** Width */
  width: number
  /** Height */
  height: number
}

/**
 * Header/footer content
 */
export interface HeaderFooterContent {
  /** HTML content for header/footer */
  html?: string
  /** Plain text content */
  text?: string
  /** Height in points */
  height?: number
  /** Show on first page */
  showOnFirst?: boolean
  /** Template variables for dynamic content (page numbers, date, etc.) */
  variables?: Record<string, unknown>
}

// =============================================================================
// Template Types
// =============================================================================

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable name (used as {{variableName}}) */
  name: string
  /** Variable type */
  type: VariableType
  /** Whether the variable is required */
  required: boolean
  /** Default value if not provided */
  default?: unknown
  /** Description for documentation */
  description?: string
  /** Validation pattern (regex) for string types */
  pattern?: string
  /** Format string for date/currency types */
  format?: string
}

/**
 * Template section definition
 */
export interface TemplateSection {
  /** Section identifier */
  id: string
  /** Section name */
  name: string
  /** HTML content for the section */
  html: string
  /** Whether section is optional (can be omitted) */
  optional?: boolean
  /** Condition for including section (variable name or expression) */
  condition?: string
  /** Section order weight */
  order?: number
}

/**
 * Document template definition
 */
export interface DocumentTemplate {
  /** Unique template identifier */
  id: string
  /** Human-readable template name */
  name: string
  /** Template description */
  description?: string
  /** Template version */
  version?: string
  /** HTML content or reference to template file */
  html: string
  /** CSS styles to include */
  css?: string
  /** Template sections (for modular templates) */
  sections?: TemplateSection[]
  /** Variable definitions */
  variables: TemplateVariable[]
  /** Default page options */
  pageOptions?: PDFPageOptions
  /** Header configuration */
  header?: HeaderFooterContent
  /** Footer configuration */
  footer?: HeaderFooterContent
  /** Signature fields for e-signature */
  signatureFields?: SignatureFieldDefinition[]
  /** Template metadata */
  metadata?: Record<string, unknown>
  /** Template category/type */
  category?: string
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

// =============================================================================
// PDF Generation Types
// =============================================================================

/**
 * PDF page options
 */
export interface PDFPageOptions {
  /** Page size preset or 'custom' */
  size?: PageSize
  /** Page orientation */
  orientation?: PageOrientation
  /** Custom dimensions (when size is 'custom') */
  dimensions?: PageDimensions
  /** Page margins */
  margins?: PageMargins
  /** Background color (hex) */
  backgroundColor?: string
  /** Whether to print background graphics */
  printBackground?: boolean
}

/**
 * Font configuration
 */
export interface FontConfig {
  /** Font family name */
  family: string
  /** Font source (URL or base64) */
  source: string
  /** Font weight */
  weight?: number | string
  /** Font style */
  style?: 'normal' | 'italic' | 'oblique'
}

/**
 * PDF generation options
 */
export interface PDFOptions {
  /** Output format */
  format?: DocumentFormat
  /** Page options */
  page?: PDFPageOptions
  /** Custom fonts to embed */
  fonts?: FontConfig[]
  /** Header content */
  header?: HeaderFooterContent
  /** Footer content */
  footer?: HeaderFooterContent
  /** Document metadata */
  metadata?: DocumentMetadata
  /** Watermark configuration */
  watermark?: WatermarkConfig
  /** PDF/A compliance level */
  pdfaCompliance?: 'pdf-a-1b' | 'pdf-a-2b' | 'pdf-a-3b'
  /** Document password protection */
  password?: string
  /** Permissions for encrypted PDF */
  permissions?: PDFPermissions
  /** Image quality (0-100) */
  imageQuality?: number
  /** Whether to compress the PDF */
  compress?: boolean
}

/**
 * PDF permission flags
 */
export interface PDFPermissions {
  /** Allow printing */
  printing?: 'none' | 'lowResolution' | 'highResolution'
  /** Allow content copying */
  copying?: boolean
  /** Allow modifying */
  modifying?: boolean
  /** Allow annotations */
  annotating?: boolean
  /** Allow form filling */
  fillingForms?: boolean
  /** Allow content extraction for accessibility */
  contentAccessibility?: boolean
  /** Allow document assembly */
  documentAssembly?: boolean
}

/**
 * Watermark configuration
 */
export interface WatermarkConfig {
  /** Watermark text */
  text?: string
  /** Watermark image (URL or base64) */
  image?: string
  /** Watermark opacity (0-1) */
  opacity?: number
  /** Watermark rotation in degrees */
  rotation?: number
  /** Font size for text watermarks */
  fontSize?: number
  /** Font color for text watermarks */
  fontColor?: string
  /** Position on page */
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'diagonal'
  /** Apply to all pages or specific pages */
  pages?: 'all' | 'first' | 'last' | number[]
}

// =============================================================================
// Document Metadata Types
// =============================================================================

/**
 * Document metadata
 */
export interface DocumentMetadata {
  /** Document title */
  title?: string
  /** Document author */
  author?: string
  /** Document subject */
  subject?: string
  /** Keywords for search */
  keywords?: string[]
  /** Creator application */
  creator?: string
  /** Producer application */
  producer?: string
  /** Creation date */
  creationDate?: Date
  /** Modification date */
  modificationDate?: Date
  /** Custom metadata fields */
  custom?: Record<string, string>
}

// =============================================================================
// Signature Types
// =============================================================================

/**
 * Signature field definition (where to place signature fields)
 */
export interface SignatureFieldDefinition {
  /** Unique field identifier */
  id: string
  /** Field type */
  type: SignatureFieldType
  /** Field label */
  label?: string
  /** Field position on page */
  position: Position
  /** Field dimensions */
  size: { width: number; height: number }
  /** Assigned signer ID */
  signerId: string
  /** Whether field is required */
  required?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Tooltip/instructions */
  tooltip?: string
  /** Tab order for signing flow */
  tabOrder?: number
  /** Font for date/text fields */
  font?: { family?: string; size?: number; color?: string }
  /** Date format for date fields */
  dateFormat?: string
}

/**
 * Signer definition
 */
export interface Signer {
  /** Unique signer identifier */
  id: string
  /** Signer name */
  name: string
  /** Signer email */
  email: string
  /** Signing order (for sequential signing) */
  order?: number
  /** Role/title */
  role?: string
  /** Authentication requirements */
  authentication?: SignerAuthentication
  /** Personal message to signer */
  message?: string
}

/**
 * Signer authentication options
 */
export interface SignerAuthentication {
  /** Require access code */
  accessCode?: string
  /** Require phone verification */
  phone?: string
  /** Require ID verification */
  idVerification?: boolean
  /** Require knowledge-based authentication */
  kba?: boolean
}

/**
 * Completed signature data
 */
export interface SignatureData {
  /** Field ID that was signed */
  fieldId: string
  /** Signer ID */
  signerId: string
  /** Signature image (base64 PNG) */
  image?: string
  /** Typed text (for typed signatures) */
  text?: string
  /** Signing timestamp */
  signedAt: Date
  /** IP address of signer */
  ipAddress?: string
  /** User agent of signer */
  userAgent?: string
  /** Geolocation (if available) */
  geolocation?: { latitude: number; longitude: number }
}

/**
 * Signing session for a signer
 */
export interface SigningSession {
  /** Session ID */
  id: string
  /** Document ID being signed */
  documentId: string
  /** Signer for this session */
  signer: Signer
  /** Access token for signing URL */
  accessToken: string
  /** Session status */
  status: 'pending' | 'active' | 'completed' | 'expired' | 'declined'
  /** Expiration time */
  expiresAt: Date
  /** When signer viewed document */
  viewedAt?: Date
  /** Completed signatures */
  signatures: SignatureData[]
  /** Session creation time */
  createdAt: Date
  /** Decline reason (if declined) */
  declineReason?: string
}

// =============================================================================
// Rendered Document Types
// =============================================================================

/**
 * Rendered document output
 */
export interface RenderedDocument {
  /** Document ID */
  id: string
  /** Template ID used */
  templateId: string
  /** Output format */
  format: DocumentFormat
  /** Document content (base64 encoded binary, or HTML string) */
  content: string
  /** Content MIME type */
  mimeType: string
  /** File size in bytes */
  sizeBytes: number
  /** Number of pages */
  pageCount: number
  /** Document metadata */
  metadata: DocumentMetadata
  /** Render timestamp */
  renderedAt: Date
  /** Variables used in rendering */
  variables: Record<string, unknown>
  /** Hash for integrity verification */
  hash?: string
}

/**
 * Signing envelope (document with signers)
 */
export interface SigningEnvelope {
  /** Envelope ID */
  id: string
  /** Envelope status */
  status: SigningStatus
  /** Rendered document */
  document: RenderedDocument
  /** Signers */
  signers: Signer[]
  /** Signing sessions */
  sessions: SigningSession[]
  /** All signatures collected */
  signatures: SignatureData[]
  /** Envelope creation time */
  createdAt: Date
  /** Envelope expiration */
  expiresAt?: Date
  /** Completion time */
  completedAt?: Date
  /** Final signed document (after all signatures) */
  signedDocument?: RenderedDocument
  /** Email subject for notifications */
  emailSubject?: string
  /** Email message for notifications */
  emailMessage?: string
  /** Webhook URL for status updates */
  webhookUrl?: string
}

// =============================================================================
// Document Parsing Types
// =============================================================================

/**
 * Extracted text from document
 */
export interface ExtractedText {
  /** Full text content */
  content: string
  /** Text by page */
  pages: string[]
  /** Confidence score (0-1) */
  confidence?: number
}

/**
 * Extracted form field
 */
export interface ExtractedFormField {
  /** Field name */
  name: string
  /** Field value */
  value: string | boolean | number
  /** Field type */
  type: 'text' | 'checkbox' | 'radio' | 'select' | 'date'
  /** Page number */
  page: number
  /** Field bounds */
  bounds?: Bounds
}

/**
 * Extracted table
 */
export interface ExtractedTable {
  /** Table headers */
  headers: string[]
  /** Table rows */
  rows: string[][]
  /** Page number */
  page: number
  /** Table bounds */
  bounds?: Bounds
}

/**
 * Document extraction result
 */
export interface DocumentExtraction {
  /** Extracted text */
  text: ExtractedText
  /** Extracted form fields */
  formFields: ExtractedFormField[]
  /** Extracted tables */
  tables: ExtractedTable[]
  /** Document metadata */
  metadata: DocumentMetadata
  /** Images extracted (base64) */
  images?: { page: number; data: string; bounds?: Bounds }[]
  /** Page count */
  pageCount: number
  /** Extraction timestamp */
  extractedAt: Date
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Validation errors */
  errors: ValidationError[]
  /** Warnings (non-blocking) */
  warnings: ValidationWarning[]
}

/**
 * Validation error
 */
export interface ValidationError {
  /** Variable or field name */
  field: string
  /** Error message */
  message: string
  /** Error code */
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_FORMAT' | 'VALIDATION_FAILED' | 'INVALID_TEMPLATE'
  /** Expected value/type */
  expected?: string
  /** Received value/type */
  received?: string
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Variable or field name */
  field: string
  /** Warning message */
  message: string
  /** Warning code */
  code: 'UNUSED_VARIABLE' | 'DEPRECATED' | 'TYPE_COERCED' | 'MISSING_OPTIONAL'
}

// =============================================================================
// Preview Types
// =============================================================================

/**
 * Document preview result
 */
export interface PreviewResult {
  /** Rendered preview */
  rendered: RenderedDocument
  /** Validation result */
  validation: ValidationResult
  /** Preview mode indicator */
  isPreview: true
  /** Preview timestamp */
  previewedAt: Date
  /** Preview image per page (base64 PNG) */
  pageImages?: string[]
}

// =============================================================================
// List Item Types
// =============================================================================

/**
 * Template list item
 */
export interface TemplateListItem {
  /** Template ID */
  id: string
  /** Template name */
  name: string
  /** Template category */
  category?: string
  /** Variable count */
  variableCount: number
  /** Has signature fields */
  hasSignatureFields: boolean
  /** Created timestamp */
  createdAt?: Date
  /** Updated timestamp */
  updatedAt?: Date
}

/**
 * Envelope list item
 */
export interface EnvelopeListItem {
  /** Envelope ID */
  id: string
  /** Document title */
  title: string
  /** Envelope status */
  status: SigningStatus
  /** Signer count */
  signerCount: number
  /** Signatures collected */
  signaturesCollected: number
  /** Created timestamp */
  createdAt: Date
  /** Expiration time */
  expiresAt?: Date
}

// =============================================================================
// Versioning Types
// =============================================================================

/**
 * Version action types for audit trail
 */
export type VersionAction = 'created' | 'updated' | 'reverted' | 'branched' | 'merged'

/**
 * Diff operation types
 */
export type DiffOperation = 'added' | 'removed' | 'modified' | 'unchanged'

/**
 * Metadata for a document version
 */
export interface DocumentVersionMetadata {
  /** Human-readable description of changes */
  description?: string
  /** User or system that created this version */
  author?: string
  /** Reason for creating this version */
  reason?: string
  /** Tags for categorizing the version */
  tags?: string[]
  /** Custom metadata fields */
  custom?: Record<string, unknown>
  /** Source version ID (for reverts or branches) */
  sourceVersionId?: string
  /** Action that created this version */
  action?: VersionAction
}

/**
 * A specific version of a document
 */
export interface DocumentVersion {
  /** Unique version identifier */
  id: string
  /** Document ID this version belongs to */
  documentId: string
  /** Version number (auto-incremented) */
  versionNumber: number
  /** Document content (binary) */
  content: Uint8Array
  /** Content hash for integrity verification */
  hash: string
  /** Size in bytes */
  sizeBytes: number
  /** MIME type of the content */
  mimeType: string
  /** Version metadata */
  metadata: DocumentVersionMetadata
  /** When this version was created */
  createdAt: Date
  /** Previous version ID (null for first version) */
  previousVersionId: string | null
  /** Next version ID (null for current version) */
  nextVersionId: string | null
  /** Whether this is the current/latest version */
  isCurrent: boolean
}

/**
 * Lightweight version listing item
 */
export interface DocumentVersionListItem {
  /** Version ID */
  id: string
  /** Version number */
  versionNumber: number
  /** Content hash */
  hash: string
  /** Size in bytes */
  sizeBytes: number
  /** Description from metadata */
  description?: string
  /** Author from metadata */
  author?: string
  /** Action that created this version */
  action?: VersionAction
  /** Creation timestamp */
  createdAt: Date
  /** Whether this is the current version */
  isCurrent: boolean
}

/**
 * Individual change in a diff
 */
export interface DiffChange {
  /** Type of change operation */
  operation: DiffOperation
  /** Page number (if applicable) */
  page?: number
  /** Location in document */
  location?: {
    start: number
    end: number
  }
  /** Original content (for removed/modified) */
  original?: string
  /** New content (for added/modified) */
  modified?: string
  /** Confidence score for content-based diff */
  confidence?: number
}

/**
 * Complete diff between two versions
 */
export interface VersionDiff {
  /** Source version ID */
  fromVersionId: string
  /** Target version ID */
  toVersionId: string
  /** Source version number */
  fromVersionNumber: number
  /** Target version number */
  toVersionNumber: number
  /** List of changes */
  changes: DiffChange[]
  /** Summary statistics */
  summary: {
    /** Number of additions */
    added: number
    /** Number of removals */
    removed: number
    /** Number of modifications */
    modified: number
    /** Total changes */
    total: number
    /** Size difference in bytes */
    sizeDelta: number
  }
  /** Whether versions are identical */
  isIdentical: boolean
  /** Diff generation timestamp */
  generatedAt: Date
}

/**
 * Audit trail entry for version history
 */
export interface VersionAuditEntry {
  /** Version ID */
  versionId: string
  /** Version number */
  versionNumber: number
  /** Action performed */
  action: VersionAction
  /** Who performed the action */
  actor?: string
  /** When the action occurred */
  timestamp: Date
  /** Description of the action */
  description?: string
  /** Additional context */
  context?: Record<string, unknown>
  /** IP address (if available) */
  ipAddress?: string
  /** User agent (if available) */
  userAgent?: string
}

/**
 * Options for version history retrieval
 */
export interface VersionHistoryOptions {
  /** Maximum number of entries to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Filter by action type */
  actions?: VersionAction[]
  /** Filter by author */
  author?: string
  /** Filter by date range */
  dateRange?: {
    from?: Date
    to?: Date
  }
  /** Include full version content */
  includeContent?: boolean
}

/**
 * Complete version history with audit trail
 */
export interface VersionHistory {
  /** Document ID */
  documentId: string
  /** Total number of versions */
  totalVersions: number
  /** Current version ID */
  currentVersionId: string
  /** Current version number */
  currentVersionNumber: number
  /** First version creation date */
  firstVersionDate: Date
  /** Latest version creation date */
  latestVersionDate: Date
  /** Audit entries */
  entries: VersionAuditEntry[]
  /** Version list (if requested) */
  versions?: DocumentVersionListItem[]
}

// =============================================================================
// Interface Definitions
// =============================================================================

/**
 * Template engine interface
 */
export interface ITemplateEngine {
  /**
   * Render a template string with variables
   */
  render(template: string, variables: Record<string, unknown>): string

  /**
   * Extract variable names from template
   */
  extractVariables(template: string): string[]
}

/**
 * PDF generator interface
 */
export interface IPDFGenerator {
  /**
   * Generate PDF from HTML content
   */
  generate(html: string, options?: PDFOptions): Promise<Uint8Array>

  /**
   * Merge multiple PDFs into one
   */
  merge(pdfs: Uint8Array[]): Promise<Uint8Array>

  /**
   * Split PDF into individual pages
   */
  split(pdf: Uint8Array): Promise<Uint8Array[]>

  /**
   * Add watermark to PDF
   */
  watermark(pdf: Uint8Array, config: WatermarkConfig): Promise<Uint8Array>

  /**
   * Encrypt PDF with password
   */
  encrypt(pdf: Uint8Array, password: string, permissions?: PDFPermissions): Promise<Uint8Array>
}

/**
 * Document parser interface
 */
export interface IDocumentParser {
  /**
   * Extract text from PDF
   */
  extractText(pdf: Uint8Array): Promise<ExtractedText>

  /**
   * Extract form fields from PDF
   */
  extractFormFields(pdf: Uint8Array): Promise<ExtractedFormField[]>

  /**
   * Extract tables from PDF
   */
  extractTables(pdf: Uint8Array): Promise<ExtractedTable[]>

  /**
   * Get document metadata
   */
  getMetadata(pdf: Uint8Array): Promise<DocumentMetadata>

  /**
   * Full document extraction
   */
  extract(pdf: Uint8Array): Promise<DocumentExtraction>
}

/**
 * Signature collector interface
 */
export interface ISignatureCollector {
  /**
   * Create signing envelope
   */
  createEnvelope(document: RenderedDocument, signers: Signer[], fields: SignatureFieldDefinition[]): Promise<SigningEnvelope>

  /**
   * Get signing URL for a signer
   */
  getSigningUrl(envelopeId: string, signerId: string): Promise<string>

  /**
   * Record signature
   */
  recordSignature(envelopeId: string, signature: SignatureData): Promise<void>

  /**
   * Complete envelope (after all signatures)
   */
  completeEnvelope(envelopeId: string): Promise<SigningEnvelope>

  /**
   * Void/cancel envelope
   */
  voidEnvelope(envelopeId: string, reason: string): Promise<void>

  /**
   * Get envelope status
   */
  getEnvelope(envelopeId: string): Promise<SigningEnvelope>
}

/**
 * Document renderer interface (main facade)
 */
export interface IDocumentRenderer {
  /**
   * Register a new template
   */
  register(template: DocumentTemplate): Promise<void>

  /**
   * Get template by ID
   */
  get(templateId: string): Promise<DocumentTemplate | null>

  /**
   * List all templates
   */
  list(): Promise<TemplateListItem[]>

  /**
   * Delete a template
   */
  delete(templateId: string): Promise<void>

  /**
   * Render a document from template
   */
  render(templateId: string, variables: Record<string, unknown>, options?: PDFOptions): Promise<RenderedDocument>

  /**
   * Preview a document (with validation)
   */
  preview(templateId: string, variables: Record<string, unknown>, options?: PDFOptions): Promise<PreviewResult>

  /**
   * Validate variables against template
   */
  validate(templateId: string, variables: Record<string, unknown>): Promise<ValidationResult>

  /**
   * Create signing envelope for document
   */
  createSigningEnvelope(document: RenderedDocument, signers: Signer[]): Promise<SigningEnvelope>

  /**
   * Parse and extract data from document
   */
  parse(document: Uint8Array): Promise<DocumentExtraction>

  /**
   * Merge multiple documents
   */
  merge(documents: Uint8Array[]): Promise<Uint8Array>

  /**
   * Split document into pages
   */
  split(document: Uint8Array): Promise<Uint8Array[]>

  // ==========================================================================
  // Versioning Methods
  // ==========================================================================

  /**
   * Create a new version of a document
   */
  createVersion(documentId: string, content: Uint8Array, metadata?: DocumentVersionMetadata): Promise<DocumentVersion>

  /**
   * List all versions of a document
   */
  listVersions(documentId: string): Promise<DocumentVersionListItem[]>

  /**
   * Get a specific version of a document
   */
  getVersion(documentId: string, versionId: string): Promise<DocumentVersion | null>

  /**
   * Revert a document to a specific version
   */
  revertToVersion(documentId: string, versionId: string): Promise<DocumentVersion>

  /**
   * Compare two versions of a document
   */
  diffVersions(documentId: string, fromVersionId: string, toVersionId: string): Promise<VersionDiff>

  /**
   * Get version history with audit trail
   */
  getVersionHistory(documentId: string, options?: VersionHistoryOptions): Promise<VersionHistory>
}

// =============================================================================
// Bulk Generation Types
// =============================================================================

/**
 * Status of a single document in bulk generation
 */
export type BulkItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

/**
 * Input for a single document in bulk generation
 */
export interface BulkRenderInput {
  /** Unique identifier for this item (for tracking) */
  id: string
  /** Template ID to use */
  templateId: string
  /** Variables for rendering */
  variables: Record<string, unknown>
  /** Optional per-document PDF options */
  options?: PDFOptions
  /** Optional metadata to attach */
  metadata?: Record<string, unknown>
}

/**
 * Result for a single document in bulk generation
 */
export interface BulkRenderResult {
  /** Input item ID */
  id: string
  /** Status of this item */
  status: BulkItemStatus
  /** Rendered document (if successful) */
  document?: RenderedDocument
  /** Error message (if failed) */
  error?: string
  /** Validation result (if applicable) */
  validation?: ValidationResult
  /** Processing duration in milliseconds */
  durationMs: number
  /** Timestamp when processing started */
  startedAt: Date
  /** Timestamp when processing finished */
  finishedAt: Date
}

/**
 * Options for bulk generation
 */
export interface BulkRenderOptions {
  /** Maximum concurrent documents to process (default: 10) */
  concurrency?: number
  /** Batch size for memory optimization (default: 100) */
  batchSize?: number
  /** Whether to continue on individual failures (default: true) */
  continueOnError?: boolean
  /** Skip items that fail validation (default: false) */
  skipInvalid?: boolean
  /** Timeout per document in milliseconds (default: 30000) */
  timeoutMs?: number
  /** Progress callback */
  onProgress?: (progress: BulkProgress) => void
  /** Per-item callback when completed */
  onItemComplete?: (result: BulkRenderResult) => void
  /** Per-batch callback when batch completes */
  onBatchComplete?: (batchNumber: number, results: BulkRenderResult[]) => void
}

/**
 * Progress information for bulk generation
 */
export interface BulkProgress {
  /** Total items to process */
  total: number
  /** Items completed (success + failed + skipped) */
  completed: number
  /** Items successfully rendered */
  succeeded: number
  /** Items that failed */
  failed: number
  /** Items skipped (validation failure with skipInvalid) */
  skipped: number
  /** Current batch number (1-indexed) */
  currentBatch: number
  /** Total number of batches */
  totalBatches: number
  /** Overall progress percentage (0-100) */
  percentage: number
  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs?: number
  /** Average time per document in milliseconds */
  averageTimeMs?: number
  /** Items currently being processed */
  inProgress: string[]
}

/**
 * Summary of bulk generation operation
 */
export interface BulkRenderSummary {
  /** Total items processed */
  total: number
  /** Items successfully rendered */
  succeeded: number
  /** Items that failed */
  failed: number
  /** Items skipped */
  skipped: number
  /** Total processing time in milliseconds */
  totalDurationMs: number
  /** Average time per document in milliseconds */
  averageTimeMs: number
  /** Start timestamp */
  startedAt: Date
  /** End timestamp */
  finishedAt: Date
  /** Failed item IDs with error messages */
  failures: Array<{ id: string; error: string }>
  /** Skipped item IDs with reasons */
  skippedItems: Array<{ id: string; reason: string }>
}

/**
 * Full result of bulk generation operation
 */
export interface BulkRenderResponse {
  /** Summary statistics */
  summary: BulkRenderSummary
  /** Individual results for each item */
  results: BulkRenderResult[]
}

/**
 * Bulk document renderer interface
 */
export interface IBulkDocumentRenderer {
  /**
   * Render multiple documents in parallel with batching
   */
  renderBulk(inputs: BulkRenderInput[], options?: BulkRenderOptions): Promise<BulkRenderResponse>

  /**
   * Validate multiple inputs before bulk rendering
   */
  validateBulk(inputs: BulkRenderInput[]): Promise<Array<{ id: string; validation: ValidationResult }>>

  /**
   * Estimate time and resources for bulk operation
   */
  estimate(inputs: BulkRenderInput[], options?: BulkRenderOptions): Promise<{
    estimatedDurationMs: number
    estimatedMemoryMb: number
    batchCount: number
    itemsPerBatch: number
  }>

  /**
   * Cancel an in-progress bulk operation
   */
  cancel(): void

  /**
   * Check if a bulk operation is in progress
   */
  isRunning(): boolean
}
