/**
 * Matryoshka Embedding Handler
 *
 * Implements Matryoshka Representation Learning for variable-length embedding prefixes.
 * Named after Russian nesting dolls, Matryoshka embeddings are trained so that the
 * first N dimensions of a longer embedding are a valid embedding on their own.
 *
 * Key features:
 * - Truncate embeddings to shorter prefixes while preserving semantic meaning
 * - Cross-dimension similarity computation
 * - Binary quantization integration
 * - Storage savings calculation
 *
 * @see https://arxiv.org/abs/2205.13147 - Matryoshka Representation Learning
 * @module db/core/vector/matryoshka
 */

// ============================================================================
// TYPES
// ============================================================================

export interface StorageSavings {
  originalBytes: number
  truncatedBytes: number
  savedBytes: number
  compressionRatio: number
  savingsPercent: number
}

export interface TruncateOptions {
  normalize?: boolean
}

export interface BatchTruncateOptions {
  normalize?: boolean
  parallel?: boolean
}

export interface MatryoshkaHandlerOptions {
  originalDimension: number
  supportedDimensions?: number[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Standard Matryoshka dimensions commonly used by embedding models
 * Includes powers of 2 and common model dimensions
 */
const STANDARD_DIMENSIONS = [64, 128, 256, 384, 512, 768, 1024, 1536, 3072]

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Compute L2 norm of a vector
 */
function l2Norm(v: Float32Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!
  }
  return Math.sqrt(sum)
}

/**
 * Normalize a vector to unit length (in-place would modify original, so we create a copy)
 */
function normalizeVector(v: Float32Array): Float32Array {
  const norm = l2Norm(v)
  if (norm === 0 || !Number.isFinite(norm)) {
    throw new Error('Cannot normalize zero-norm vector: division by zero')
  }
  const normalized = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    normalized[i] = v[i]! / norm
  }
  return normalized
}

/**
 * Compute cosine similarity between two same-length vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return dot / denom
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Truncate an embedding to a specified target dimension.
 *
 * Matryoshka embeddings are trained such that the first N dimensions
 * contain the most important semantic information, allowing truncation
 * without significant information loss.
 *
 * @param embedding - The original embedding vector
 * @param targetDimension - The target dimension to truncate to
 * @param options - Optional settings (normalize: whether to L2-normalize after truncation)
 * @returns Truncated embedding as Float32Array
 * @throws Error if targetDimension exceeds original or is non-positive
 */
export function truncateEmbedding(
  embedding: Float32Array,
  targetDimension: number,
  options?: TruncateOptions
): Float32Array {
  // Validate target dimension
  if (targetDimension <= 0) {
    throw new Error('Target dimension must be a positive integer')
  }
  if (targetDimension > embedding.length) {
    throw new Error(
      `Invalid dimension: target ${targetDimension} is larger than original ${embedding.length}`
    )
  }

  // Create truncated view (first N dimensions)
  const truncated = new Float32Array(targetDimension)
  for (let i = 0; i < targetDimension; i++) {
    truncated[i] = embedding[i]!
  }

  // Optionally normalize
  if (options?.normalize) {
    return normalizeVector(truncated)
  }

  return truncated
}

/**
 * Batch truncate multiple embeddings efficiently.
 *
 * @param embeddings - Array of embeddings to truncate
 * @param targetDimension - Target dimension for all embeddings
 * @param options - Optional settings (normalize, parallel)
 * @returns Array of truncated embeddings
 */
export function batchTruncate(
  embeddings: Float32Array[],
  targetDimension: number,
  options?: BatchTruncateOptions
): Float32Array[] {
  if (embeddings.length === 0) {
    return []
  }

  return embeddings.map((embedding) =>
    truncateEmbedding(embedding, targetDimension, { normalize: options?.normalize })
  )
}

/**
 * Check if a dimension is a valid Matryoshka dimension.
 *
 * Valid dimensions are:
 * - Powers of 2 (64, 128, 256, 512, 1024)
 * - Standard model dimensions (384, 768, 1536, 3072)
 * - Must not exceed original dimension
 * - Must be positive
 *
 * @param dimension - The dimension to validate
 * @param originalDimension - The original embedding dimension
 * @returns true if valid, false otherwise
 */
export function isValidMatryoshkaDimension(
  dimension: number,
  originalDimension: number
): boolean {
  // Must be positive
  if (dimension <= 0) {
    return false
  }

  // Must not exceed original
  if (dimension > originalDimension) {
    return false
  }

  // Check if it's a standard dimension
  if (STANDARD_DIMENSIONS.includes(dimension)) {
    return true
  }

  // Check if it's a power of 2 (up to original dimension)
  if ((dimension & (dimension - 1)) === 0 && dimension > 0) {
    return true
  }

  return false
}

/**
 * Compute storage savings from truncation.
 *
 * @param originalDimension - Original embedding dimension
 * @param targetDimension - Target truncated dimension
 * @returns Storage savings metrics
 */
export function computeStorageSavings(
  originalDimension: number,
  targetDimension: number
): StorageSavings {
  const bytesPerFloat = 4 // Float32 = 4 bytes

  const originalBytes = originalDimension * bytesPerFloat
  const truncatedBytes = targetDimension * bytesPerFloat
  const savedBytes = originalBytes - truncatedBytes
  const compressionRatio = originalDimension / targetDimension
  const savingsPercent = ((originalDimension - targetDimension) / originalDimension) * 100

  return {
    originalBytes,
    truncatedBytes,
    savedBytes,
    compressionRatio,
    savingsPercent,
  }
}

/**
 * Truncate embedding and then quantize to specified bit depth.
 *
 * Combines Matryoshka truncation with binary/scalar quantization
 * for maximum storage savings.
 *
 * @param embedding - Original embedding
 * @param targetDimension - Dimension to truncate to
 * @param quantizationBits - Bits per dimension (1=binary, 2, 4, 8)
 * @returns Quantized embedding as Uint8Array
 */
export function truncateAndQuantize(
  embedding: Float32Array,
  targetDimension: number,
  quantizationBits: number
): Uint8Array {
  // First truncate
  const truncated = truncateEmbedding(embedding, targetDimension)

  // Calculate output size in bytes
  const totalBits = targetDimension * quantizationBits
  const numBytes = Math.ceil(totalBits / 8)
  const output = new Uint8Array(numBytes)

  if (quantizationBits === 1) {
    // Binary quantization: 1 bit per dimension
    // Sign bit: positive = 1, negative/zero = 0
    for (let i = 0; i < targetDimension; i++) {
      if (truncated[i]! > 0) {
        const byteIndex = Math.floor(i / 8)
        const bitIndex = i % 8
        output[byteIndex]! |= 1 << bitIndex
      }
    }
  } else if (quantizationBits === 2) {
    // 2-bit quantization: 4 levels
    for (let i = 0; i < targetDimension; i++) {
      // Map value to 0-3 range
      const normalized = Math.max(-1, Math.min(1, truncated[i]!))
      const level = Math.floor((normalized + 1) * 1.999) // 0, 1, 2, or 3
      const byteIndex = Math.floor((i * 2) / 8)
      const bitOffset = (i * 2) % 8
      output[byteIndex]! |= level << bitOffset
    }
  } else if (quantizationBits === 4) {
    // 4-bit quantization: 16 levels
    for (let i = 0; i < targetDimension; i++) {
      const normalized = Math.max(-1, Math.min(1, truncated[i]!))
      const level = Math.floor((normalized + 1) * 7.999) // 0-15
      const byteIndex = Math.floor((i * 4) / 8)
      const bitOffset = (i * 4) % 8
      output[byteIndex]! |= level << bitOffset
    }
  } else if (quantizationBits === 8) {
    // 8-bit quantization: 256 levels (int8-like)
    for (let i = 0; i < targetDimension; i++) {
      const normalized = Math.max(-1, Math.min(1, truncated[i]!))
      const level = Math.floor((normalized + 1) * 127.999) // 0-255
      output[i] = level
    }
  } else {
    throw new Error(`Unsupported quantization bits: ${quantizationBits}`)
  }

  return output
}

// ============================================================================
// HANDLER CLASS
// ============================================================================

/**
 * MatryoshkaHandler provides a complete interface for working with
 * Matryoshka embeddings, including truncation, normalization,
 * similarity computation, and storage optimization.
 */
export class MatryoshkaHandler {
  readonly originalDimension: number
  readonly supportedDimensions: number[]

  constructor(options: MatryoshkaHandlerOptions) {
    this.originalDimension = options.originalDimension

    // Use custom dimensions or generate default supported dimensions
    if (options.supportedDimensions) {
      this.supportedDimensions = [...options.supportedDimensions].sort((a, b) => a - b)
    } else {
      // Generate default supported dimensions based on original dimension
      this.supportedDimensions = STANDARD_DIMENSIONS.filter(
        (d) => d <= this.originalDimension
      )
    }
  }

  /**
   * Truncate an embedding to the specified dimension.
   */
  truncate(embedding: Float32Array, targetDimension: number): Float32Array {
    return truncateEmbedding(embedding, targetDimension)
  }

  /**
   * Truncate multiple embeddings to the specified dimension.
   */
  truncateBatch(embeddings: Float32Array[], targetDimension: number): Float32Array[] {
    return batchTruncate(embeddings, targetDimension)
  }

  /**
   * Normalize an embedding to unit length.
   */
  normalize(embedding: Float32Array): Float32Array {
    return normalizeVector(embedding)
  }

  /**
   * Compute cosine similarity between two same-length vectors.
   */
  similarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`)
    }
    return cosineSimilarity(a, b)
  }

  /**
   * Compute similarity between vectors of different dimensions.
   * Uses the minimum dimension (truncates the longer vector).
   */
  crossDimensionSimilarity(a: Float32Array, b: Float32Array): number {
    const minDim = Math.min(a.length, b.length)

    // Truncate both to minimum dimension
    const aTrunc = a.length === minDim ? a : truncateEmbedding(a, minDim)
    const bTrunc = b.length === minDim ? b : truncateEmbedding(b, minDim)

    return cosineSimilarity(aTrunc, bTrunc)
  }

  /**
   * Get storage savings for a given target dimension.
   */
  getStorageSavings(targetDimension: number): StorageSavings {
    return computeStorageSavings(this.originalDimension, targetDimension)
  }

  /**
   * Validate if a dimension is supported by this handler.
   */
  validateDimension(dimension: number): boolean {
    // If custom dimensions were provided, only allow those
    if (this.supportedDimensions.length > 0) {
      // Check if dimension is in supported list
      if (!this.supportedDimensions.includes(dimension)) {
        return false
      }
    }

    // Also must not exceed original
    return dimension > 0 && dimension <= this.originalDimension
  }

  /**
   * Get the list of supported dimensions.
   */
  getSupportedDimensions(): number[] {
    return [...this.supportedDimensions]
  }
}
