/**
 * BulkDocumentGenerator - Efficient batch document processing
 *
 * Provides bulk document generation with:
 * - Generate from array of data
 * - Batched generation with configurable batch sizes
 * - Async iterator for streaming large datasets
 * - Progress tracking and callbacks
 * - Error handling per document (continue on failure)
 * - Memory-efficient processing for large batches
 *
 * @example
 * ```typescript
 * import { createBulkDocumentGenerator } from 'db/primitives/documents/bulk-generator'
 *
 * const generator = createBulkDocumentGenerator()
 *
 * // Bulk generation
 * const result = await generator.generate('Hello {{name}}!', [
 *   { name: 'Alice' },
 *   { name: 'Bob' },
 * ])
 *
 * // Batched processing
 * for await (const batch of generator.generateBatch(template, dataArray, 100)) {
 *   console.log(`Batch ${batch.batchIndex}: ${batch.documents.length} documents`)
 * }
 *
 * // Async streaming
 * for await (const doc of generator.generateAsync(template, dataArray)) {
 *   console.log(doc.content)
 * }
 * ```
 *
 * @module db/primitives/documents/bulk-generator
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Generated document with content and metadata
 */
export interface GeneratedDocument {
  /** The rendered content */
  content: string
  /** Index in the original data array */
  index: number
  /** Original data used for generation */
  data: Record<string, unknown>
  /** Output format (if specified) */
  format?: string
  /** Additional metadata from _metadata field in data */
  metadata?: Record<string, unknown>
}

/**
 * Error information for failed document generation
 */
export interface GenerationError {
  /** Index in the original data array */
  index: number
  /** Original data that caused the error */
  data: Record<string, unknown>
  /** Error message */
  message: string
  /** Original error object */
  error: Error
}

/**
 * Statistics for generation run
 */
export interface GenerationStats {
  /** Total processing time in milliseconds */
  processingTimeMs: number
  /** Start time of generation */
  startTime: Date
  /** End time of generation */
  endTime: Date
  /** Average time per document in milliseconds */
  avgTimePerDocMs: number
  /** Documents processed per second */
  docsPerSecond: number
}

/**
 * Result of bulk generation
 */
export interface GenerationResult {
  /** Successfully generated documents */
  documents: GeneratedDocument[]
  /** Number of successful generations */
  successCount: number
  /** Number of failed generations */
  errorCount: number
  /** Total documents attempted */
  totalCount: number
  /** Errors encountered during generation */
  errors: GenerationError[]
  /** Generation statistics */
  stats: GenerationStats
}

/**
 * Result of batch generation
 */
export interface BatchResult {
  /** Documents in this batch */
  documents: GeneratedDocument[]
  /** Index of this batch (0-based) */
  batchIndex: number
  /** Starting index in original data array */
  startIndex: number
  /** Ending index in original data array (exclusive) */
  endIndex: number
  /** Errors in this batch */
  errors: GenerationError[]
  /** Success count in this batch */
  successCount: number
  /** Error count in this batch */
  errorCount: number
}

/**
 * Progress callback signature
 */
export type ProgressCallback = (
  current: number,
  total: number,
  percentage: number,
  document?: GeneratedDocument
) => void

/**
 * Batch progress callback signature
 */
export type BatchProgressCallback = (batchIndex: number, totalBatches: number) => void

/**
 * Error callback signature
 */
export type ErrorCallback = (error: Error, index: number, data: Record<string, unknown>) => void

/**
 * Memory pressure callback signature
 */
export type MemoryPressureCallback = () => void

/**
 * Minimal template engine interface
 */
export interface TemplateEngineInterface {
  render: (template: string, data: Record<string, unknown>) => string
}

/**
 * Generation options
 */
export interface GenerationOptions {
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Error callback */
  onError?: ErrorCallback
  /** Memory pressure callback */
  onMemoryPressure?: MemoryPressureCallback
  /** Custom template engine */
  templateEngine?: TemplateEngineInterface
  /** Output format for documents */
  outputFormat?: string
}

/**
 * Batch generation options
 */
export interface BatchGenerationOptions extends GenerationOptions {
  /** Batch progress callback */
  onBatchProgress?: BatchProgressCallback
}

/**
 * Bulk generator configuration
 */
export interface BulkGeneratorConfig {
  /** Default batch size when not specified (default: 100) */
  defaultBatchSize?: number
  /** Continue processing on error (default: true) */
  continueOnError?: boolean
  /** Maximum concurrent processing (default: 1) */
  maxConcurrency?: number
  /** Maximum batch memory in MB (default: 50) */
  maxBatchMemoryMB?: number
}

// =============================================================================
// Default Template Engine
// =============================================================================

/**
 * Simple default template engine for basic variable substitution
 * Supports:
 * - Simple variables: {{name}}
 * - Nested paths: {{customer.name}}
 * - Conditionals: {{#if condition}}...{{else}}...{{/if}}
 * - Loops: {{#each items}}...{{/each}}
 */
class DefaultTemplateEngine implements TemplateEngineInterface {
  render(template: string, data: Record<string, unknown>): string {
    let result = template

    // Process loops first
    result = this.processLoops(result, data)

    // Process conditionals
    result = this.processConditionals(result, data)

    // Process variables
    result = this.processVariables(result, data)

    return result
  }

  private processLoops(template: string, data: Record<string, unknown>): string {
    const loopPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g

    return template.replace(loopPattern, (_, arrayName, body) => {
      const array = this.getValue(arrayName, data)
      if (!Array.isArray(array)) return ''

      return array
        .map((item, index) => {
          const itemData: Record<string, unknown> = {
            ...data,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          }

          if (typeof item === 'object' && item !== null) {
            Object.assign(itemData, item)
          }

          return this.render(body, itemData)
        })
        .join('')
    })
  }

  private processConditionals(template: string, data: Record<string, unknown>): string {
    // Process if/else blocks
    const ifElsePattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g
    let result = template.replace(ifElsePattern, (_, condition, ifBody, elseBody) => {
      const value = this.getValue(condition, data)
      return this.isTruthy(value) ? this.render(ifBody, data) : this.render(elseBody, data)
    })

    // Process if blocks without else
    const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
    result = result.replace(ifPattern, (_, condition, body) => {
      const value = this.getValue(condition, data)
      return this.isTruthy(value) ? this.render(body, data) : ''
    })

    return result
  }

  private processVariables(template: string, data: Record<string, unknown>): string {
    const varPattern = /\{\{\s*([a-zA-Z_@][a-zA-Z0-9_.]*)\s*\}\}/g

    return template.replace(varPattern, (match, path) => {
      const value = this.getValue(path, data)
      if (value === undefined || value === null) return ''
      return String(value)
    })
  }

  private getValue(path: string, data: Record<string, unknown>): unknown {
    if (path === 'this' || path.startsWith('@')) {
      return data[path]
    }

    const parts = path.split('.')
    let current: unknown = data

    for (const part of parts) {
      if (current === undefined || current === null) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }
}

// =============================================================================
// BulkDocumentGenerator Implementation
// =============================================================================

/**
 * Bulk document generator for efficient batch processing
 */
export class BulkDocumentGenerator {
  private config: Required<BulkGeneratorConfig>
  private defaultEngine: TemplateEngineInterface

  constructor(config: BulkGeneratorConfig = {}) {
    this.config = {
      defaultBatchSize: config.defaultBatchSize ?? 100,
      continueOnError: config.continueOnError ?? true,
      maxConcurrency: config.maxConcurrency ?? 1,
      maxBatchMemoryMB: config.maxBatchMemoryMB ?? 50,
    }
    this.defaultEngine = new DefaultTemplateEngine()
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<BulkGeneratorConfig> {
    return { ...this.config }
  }

  /**
   * Generate documents from an array of data
   */
  async generate(
    template: string,
    dataArray: Array<Record<string, unknown>>,
    options: GenerationOptions = {}
  ): Promise<GenerationResult> {
    const startTime = new Date()
    const documents: GeneratedDocument[] = []
    const errors: GenerationError[] = []
    const engine = options.templateEngine ?? this.defaultEngine
    const total = dataArray.length

    for (let i = 0; i < dataArray.length; i++) {
      const data = dataArray[i]!

      try {
        const content = engine.render(template, data)
        const doc: GeneratedDocument = {
          content,
          index: i,
          data,
          format: options.outputFormat,
          metadata: data._metadata as Record<string, unknown> | undefined,
        }

        documents.push(doc)

        // Call progress callback
        if (options.onProgress) {
          const percentage = Math.round(((i + 1) / total) * 100)
          options.onProgress(i + 1, total, percentage, doc)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        const genError: GenerationError = {
          index: i,
          data,
          message: error.message,
          error,
        }

        errors.push(genError)

        // Call error callback
        if (options.onError) {
          options.onError(error, i, data)
        }

        // Stop if not continuing on error
        if (!this.config.continueOnError) {
          throw error
        }

        // Still call progress for failed items
        if (options.onProgress) {
          const percentage = Math.round(((i + 1) / total) * 100)
          options.onProgress(i + 1, total, percentage)
        }
      }
    }

    const endTime = new Date()
    const processingTimeMs = endTime.getTime() - startTime.getTime()
    const successCount = documents.length
    const avgTimePerDocMs = total > 0 ? processingTimeMs / total : 0
    const docsPerSecond = processingTimeMs > 0 ? (successCount / processingTimeMs) * 1000 : 0

    return {
      documents,
      successCount,
      errorCount: errors.length,
      totalCount: total,
      errors,
      stats: {
        processingTimeMs,
        startTime,
        endTime,
        avgTimePerDocMs,
        docsPerSecond,
      },
    }
  }

  /**
   * Generate documents in batches using an async generator
   */
  async *generateBatch(
    template: string,
    dataArray: Array<Record<string, unknown>>,
    batchSize?: number,
    options: BatchGenerationOptions = {}
  ): AsyncGenerator<BatchResult> {
    const size = batchSize ?? this.config.defaultBatchSize
    const total = dataArray.length
    const totalBatches = Math.ceil(total / size)
    const engine = options.templateEngine ?? this.defaultEngine

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * size
      const endIndex = Math.min(startIndex + size, total)
      const batchData = dataArray.slice(startIndex, endIndex)

      const documents: GeneratedDocument[] = []
      const errors: GenerationError[] = []

      for (let i = 0; i < batchData.length; i++) {
        const data = batchData[i]!
        const globalIndex = startIndex + i

        try {
          const content = engine.render(template, data)
          const doc: GeneratedDocument = {
            content,
            index: globalIndex,
            data,
            format: options.outputFormat,
            metadata: data._metadata as Record<string, unknown> | undefined,
          }

          documents.push(doc)

          // Call progress callback
          if (options.onProgress) {
            const percentage = Math.round(((globalIndex + 1) / total) * 100)
            options.onProgress(globalIndex + 1, total, percentage, doc)
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          const genError: GenerationError = {
            index: globalIndex,
            data,
            message: error.message,
            error,
          }

          errors.push(genError)

          if (options.onError) {
            options.onError(error, globalIndex, data)
          }

          if (!this.config.continueOnError) {
            throw error
          }
        }
      }

      // Call batch progress callback
      if (options.onBatchProgress) {
        options.onBatchProgress(batchIndex, totalBatches)
      }

      yield {
        documents,
        batchIndex,
        startIndex,
        endIndex,
        errors,
        successCount: documents.length,
        errorCount: errors.length,
      }
    }
  }

  /**
   * Generate documents one at a time using an async generator
   * Memory-efficient for large datasets
   */
  async *generateAsync(
    template: string,
    dataArray: Array<Record<string, unknown>>,
    options: GenerationOptions = {}
  ): AsyncGenerator<GeneratedDocument> {
    const engine = options.templateEngine ?? this.defaultEngine
    const total = dataArray.length

    for (let i = 0; i < dataArray.length; i++) {
      const data = dataArray[i]!

      try {
        const content = engine.render(template, data)
        const doc: GeneratedDocument = {
          content,
          index: i,
          data,
          format: options.outputFormat,
          metadata: data._metadata as Record<string, unknown> | undefined,
        }

        // Call progress callback
        if (options.onProgress) {
          const percentage = Math.round(((i + 1) / total) * 100)
          options.onProgress(i + 1, total, percentage, doc)
        }

        yield doc
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (options.onError) {
          options.onError(error, i, data)
        }

        if (!this.config.continueOnError) {
          throw error
        }

        // Skip failed documents in streaming mode
        continue
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new BulkDocumentGenerator instance
 */
export function createBulkDocumentGenerator(config?: BulkGeneratorConfig): BulkDocumentGenerator {
  return new BulkDocumentGenerator(config)
}

// =============================================================================
// Default Export
// =============================================================================

export default BulkDocumentGenerator
