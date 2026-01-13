/**
 * FormEngine File Upload Module
 *
 * File validation, chunked uploads, progress tracking, and security checks
 */

import type {
  FileUploadConfig,
  UploadedFile,
  FileUploadProgress,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

interface MockFile {
  name: string
  size: number
  type: string
  content?: string
}

export interface FileValidationResult {
  valid: boolean
  error?: string
}

export interface MultiFileValidationResult {
  valid: boolean
  error?: string
  validFiles: MockFile[]
  invalidFiles: Array<MockFile & { error: string }>
}

export interface FileChunk {
  index: number
  start: number
  end: number
  data?: Blob
}

// Dangerous file extensions that should be blocked
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr',
  '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf',
  '.ps1', '.psm1', '.psd1', '.sh', '.bash',
  '.app', '.dmg', '.pkg', '.deb', '.rpm',
]

// Magic bytes for common file types
const MAGIC_BYTES: Record<string, string[]> = {
  'image/png': ['\x89PNG'],
  'image/jpeg': ['\xFF\xD8\xFF'],
  'image/gif': ['GIF87a', 'GIF89a'],
  'application/pdf': ['%PDF'],
  'application/zip': ['PK\x03\x04', 'PK\x05\x06'],
}

// ============================================================================
// FILE VALIDATOR CLASS
// ============================================================================

export class FileValidator {
  private config: FileUploadConfig
  private uploads: Map<string, UploadedFile> = new Map()
  private progressListeners: Array<(progress: FileUploadProgress) => void> = []
  private overallProgressListeners: Array<(progress: number) => void> = []
  private fileProgress: Map<string, number> = new Map()

  constructor(config: FileUploadConfig = {}) {
    this.config = config
  }

  /**
   * Validate a single file against the config
   */
  validateFile(file: MockFile): FileValidationResult {
    // Type validation
    if (this.config.accept && this.config.accept.length > 0) {
      if (!this.isTypeAllowed(file)) {
        return {
          valid: false,
          error: `File type not allowed. Accepted types: ${this.config.accept.join(', ')}`,
        }
      }
    }

    // Size validation
    if (this.config.maxSize && file.size > this.config.maxSize) {
      const maxSizeMB = (this.config.maxSize / (1024 * 1024)).toFixed(1)
      return {
        valid: false,
        error: `File size exceeds maximum allowed (${maxSizeMB}MB)`,
      }
    }

    if (this.config.minSize && file.size < this.config.minSize) {
      const minSizeKB = (this.config.minSize / 1024).toFixed(1)
      return {
        valid: false,
        error: `File size is below minimum required (${minSizeKB}KB)`,
      }
    }

    return { valid: true }
  }

  /**
   * Validate multiple files
   */
  validateFiles(files: MockFile[]): MultiFileValidationResult {
    const validFiles: MockFile[] = []
    const invalidFiles: Array<MockFile & { error: string }> = []

    // Check multiple file permission
    if (this.config.multiple === false && files.length > 1) {
      return {
        valid: false,
        error: 'Only single file upload is allowed',
        validFiles: [],
        invalidFiles: files.map(f => ({ ...f, error: 'Multiple files not allowed' })),
      }
    }

    // Check max files
    if (this.config.maxFiles && files.length > this.config.maxFiles) {
      return {
        valid: false,
        error: `Maximum ${this.config.maxFiles} files allowed`,
        validFiles: [],
        invalidFiles: files.map(f => ({ ...f, error: 'Exceeds max files limit' })),
      }
    }

    // Check min files
    if (this.config.minFiles && files.length < this.config.minFiles) {
      return {
        valid: false,
        error: `Minimum ${this.config.minFiles} files required`,
        validFiles: [],
        invalidFiles: [],
      }
    }

    // Validate each file
    for (const file of files) {
      const result = this.validateFile(file)
      if (result.valid) {
        validFiles.push(file)
      } else {
        invalidFiles.push({ ...file, error: result.error || 'Unknown error' })
      }
    }

    const allValid = invalidFiles.length === 0

    return {
      valid: allValid,
      error: allValid ? undefined : `${invalidFiles.length} file(s) failed validation`,
      validFiles,
      invalidFiles,
    }
  }

  /**
   * Validate that required files are present
   */
  validateRequired(files: MockFile[]): boolean {
    return files.length > 0
  }

  /**
   * Security validation
   */
  validateSecurity(file: MockFile): FileValidationResult {
    // Check for dangerous extensions
    const fileName = file.name.toLowerCase()
    for (const ext of DANGEROUS_EXTENSIONS) {
      if (fileName.endsWith(ext)) {
        return {
          valid: false,
          error: `File extension not allowed for security reasons: ${ext}`,
        }
      }
    }

    // Check for double extensions (e.g., file.pdf.exe)
    const parts = fileName.split('.')
    if (parts.length > 2) {
      const lastExt = `.${parts[parts.length - 1]}`
      const secondLastExt = `.${parts[parts.length - 2]}`
      if (DANGEROUS_EXTENSIONS.includes(lastExt) || DANGEROUS_EXTENSIONS.includes(secondLastExt)) {
        return {
          valid: false,
          error: 'Double file extension detected, possible security risk',
        }
      }
    }

    return { valid: true }
  }

  /**
   * Validate file content matches declared type (magic bytes)
   */
  validateMagicBytes(file: MockFile & { content?: string }): FileValidationResult {
    if (!file.content) {
      return { valid: true } // Can't validate without content
    }

    const expectedMagic = MAGIC_BYTES[file.type.toLowerCase()]
    if (!expectedMagic) {
      return { valid: true } // No magic bytes defined for this type
    }

    const fileStart = file.content.slice(0, 10)
    const matches = expectedMagic.some(magic => fileStart.startsWith(magic))

    if (!matches) {
      return {
        valid: false,
        error: 'File content does not match declared type',
      }
    }

    return { valid: true }
  }

  /**
   * Check if file type is allowed
   */
  private isTypeAllowed(file: MockFile): boolean {
    if (!this.config.accept || this.config.accept.length === 0) {
      return true
    }

    const fileType = file.type.toLowerCase()
    const fileName = file.name.toLowerCase()

    for (const allowed of this.config.accept) {
      // MIME type wildcard (e.g., image/*)
      if (allowed.endsWith('/*')) {
        const prefix = allowed.slice(0, -2)
        if (fileType.startsWith(prefix)) {
          return true
        }
      }

      // Exact MIME type match
      if (fileType === allowed.toLowerCase()) {
        return true
      }

      // Extension match (e.g., .pdf)
      if (allowed.startsWith('.') && fileName.endsWith(allowed.toLowerCase())) {
        return true
      }
    }

    return false
  }

  // ============================================================================
  // CHUNKED UPLOAD
  // ============================================================================

  /**
   * Split a file into chunks for upload
   */
  createChunks(file: MockFile): FileChunk[] {
    const chunkSize = this.config.chunkSize || 1024 * 1024 // Default 1MB
    const chunks: FileChunk[] = []
    let offset = 0
    let index = 0

    while (offset < file.size) {
      const end = Math.min(offset + chunkSize, file.size)
      chunks.push({
        index,
        start: offset,
        end,
      })
      offset = end
      index++
    }

    return chunks
  }

  // ============================================================================
  // PROGRESS TRACKING
  // ============================================================================

  /**
   * Register a progress listener
   */
  onProgress(listener: (progress: FileUploadProgress) => void): void {
    this.progressListeners.push(listener)
  }

  /**
   * Register an overall progress listener
   */
  onOverallProgress(listener: (progress: number) => void): void {
    this.overallProgressListeners.push(listener)
  }

  /**
   * Simulate upload progress (for testing)
   */
  simulateProgress(fileId: string, fileName: string, totalSize: number): void {
    const intervals = 10
    const chunkSize = totalSize / intervals

    for (let i = 1; i <= intervals; i++) {
      const loaded = Math.min(i * chunkSize, totalSize)
      const progress: FileUploadProgress = {
        fileId,
        fileName,
        loaded,
        total: totalSize,
        progress: Math.round((loaded / totalSize) * 100),
      }

      for (const listener of this.progressListeners) {
        listener(progress)
      }
    }
  }

  /**
   * Set progress for a file
   */
  setFileProgress(fileId: string, progress: number): void {
    this.fileProgress.set(fileId, progress)
  }

  /**
   * Update overall progress
   */
  updateOverallProgress(): void {
    const files = Array.from(this.fileProgress.values())
    if (files.length === 0) {
      return
    }

    const total = files.reduce((sum, p) => sum + p, 0)
    const overall = total / files.length

    for (const listener of this.overallProgressListeners) {
      listener(overall)
    }
  }

  // ============================================================================
  // PREVIEW GENERATION
  // ============================================================================

  /**
   * Generate a preview for an image file
   */
  async generatePreview(file: MockFile): Promise<string | null> {
    if (!this.config.preview) {
      return null
    }

    // Only generate previews for images
    if (!file.type.startsWith('image/')) {
      return null
    }

    // In real implementation, would use FileReader.readAsDataURL
    // For testing, return a mock data URL
    return `data:${file.type};base64,mock-preview-data`
  }

  // ============================================================================
  // UPLOAD METADATA
  // ============================================================================

  /**
   * Create upload metadata for a file
   */
  createUploadMetadata(file: MockFile): UploadedFile {
    const id = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`

    const metadata: UploadedFile = {
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date(),
      progress: 0,
    }

    this.uploads.set(id, metadata)
    return metadata
  }

  /**
   * Get upload metadata
   */
  getUploadMetadata(id: string): UploadedFile | undefined {
    return this.uploads.get(id)
  }

  /**
   * Update upload progress
   */
  updateUploadProgress(id: string, progress: number): void {
    const upload = this.uploads.get(id)
    if (upload) {
      upload.progress = progress
    }
  }

  /**
   * Complete an upload
   */
  completeUpload(id: string, url: string): void {
    const upload = this.uploads.get(id)
    if (upload) {
      upload.progress = 100
      upload.url = url
    }
  }

  /**
   * Mark an upload as failed
   */
  failUpload(id: string, error: string): void {
    const upload = this.uploads.get(id)
    if (upload) {
      upload.error = error
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a file validator
 */
export function createFileValidator(config: FileUploadConfig = {}): FileValidator {
  return new FileValidator(config)
}

/**
 * Validate a single file
 */
export function validateFile(file: MockFile, config: FileUploadConfig): FileValidationResult {
  const validator = createFileValidator(config)
  return validator.validateFile(file)
}

/**
 * Validate multiple files
 */
export function validateFiles(files: MockFile[], config: FileUploadConfig): MultiFileValidationResult {
  const validator = createFileValidator(config)
  return validator.validateFiles(files)
}
