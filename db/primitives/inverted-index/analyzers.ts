/**
 * Text Analyzers for Full-Text Search
 *
 * Provides configurable text analysis for tokenization:
 * - StandardAnalyzer: Lowercase, whitespace/punctuation split
 * - NgramAnalyzer: Generate n-grams for fuzzy matching
 * - EdgeNgramAnalyzer: Generate edge n-grams for autocomplete
 *
 * @module db/primitives/inverted-index/analyzers
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Token with position information
 */
export interface TokenWithPosition {
  /** The token string */
  token: string
  /** Position index (0-based) */
  position: number
}

/**
 * Base analyzer interface
 */
export interface Analyzer {
  /**
   * Tokenize text into an array of tokens
   */
  tokenize(text: string): string[]

  /**
   * Tokenize text with position information
   */
  tokenizeWithPositions(text: string): TokenWithPosition[]
}

/**
 * Standard analyzer options
 */
export interface StandardAnalyzerOptions {
  /** Minimum token length (default: 1) */
  minTokenLength?: number
  /** Maximum token length (default: 255) */
  maxTokenLength?: number
  /** Stop words to filter out */
  stopWords?: string[]
}

/**
 * N-gram analyzer options
 */
export interface NgramAnalyzerOptions {
  /** Minimum n-gram size (default: 2) */
  minGram?: number
  /** Maximum n-gram size (default: 3) */
  maxGram?: number
}

/**
 * Edge n-gram analyzer options
 */
export interface EdgeNgramAnalyzerOptions {
  /** Minimum edge n-gram size (default: 1) */
  minGram?: number
  /** Maximum edge n-gram size (default: 20) */
  maxGram?: number
}

/**
 * Analyzer type for factory
 */
export type AnalyzerType = 'standard' | 'ngram' | 'edge_ngram'

/**
 * Combined analyzer options for factory
 */
export interface AnalyzerOptions extends StandardAnalyzerOptions, NgramAnalyzerOptions, EdgeNgramAnalyzerOptions {
  /** Analyzer type */
  type?: AnalyzerType
}

// ============================================================================
// StandardAnalyzer
// ============================================================================

/**
 * Standard text analyzer
 *
 * Performs lowercase normalization and splits on whitespace/punctuation.
 * Optionally filters by token length and stop words.
 */
export class StandardAnalyzer implements Analyzer {
  private minTokenLength: number
  private maxTokenLength: number
  private stopWords: Set<string>

  constructor(options: StandardAnalyzerOptions = {}) {
    this.minTokenLength = options.minTokenLength ?? 1
    this.maxTokenLength = options.maxTokenLength ?? 255
    this.stopWords = new Set(options.stopWords?.map((w) => w.toLowerCase()) ?? [])
  }

  /**
   * Tokenize text into lowercase tokens
   */
  tokenize(text: string): string[] {
    // Convert to lowercase
    const lower = text.toLowerCase()

    // Split on non-alphanumeric characters (preserving unicode letters)
    const tokens = lower.split(/[^a-z0-9\u00C0-\u024F]+/).filter((t) => t.length > 0)

    // Filter by length and stop words
    return tokens.filter((t) => {
      if (t.length < this.minTokenLength) return false
      if (t.length > this.maxTokenLength) return false
      if (this.stopWords.has(t)) return false
      return true
    })
  }

  /**
   * Tokenize with position information
   */
  tokenizeWithPositions(text: string): TokenWithPosition[] {
    const tokens = this.tokenize(text)
    return tokens.map((token, index) => ({
      token,
      position: index,
    }))
  }
}

// ============================================================================
// NgramAnalyzer
// ============================================================================

/**
 * N-gram analyzer for fuzzy matching
 *
 * Generates overlapping n-grams from tokens for substring matching.
 * For example, "test" with minGram=2, maxGram=3 produces:
 * ["te", "es", "st", "tes", "est"]
 */
export class NgramAnalyzer implements Analyzer {
  private minGram: number
  private maxGram: number
  private baseAnalyzer: StandardAnalyzer

  constructor(options: NgramAnalyzerOptions = {}) {
    this.minGram = options.minGram ?? 2
    this.maxGram = options.maxGram ?? 3
    this.baseAnalyzer = new StandardAnalyzer()
  }

  /**
   * Generate n-grams for text
   */
  tokenize(text: string): string[] {
    // First tokenize with standard analyzer
    const tokens = this.baseAnalyzer.tokenize(text)

    // Generate n-grams for each token
    const ngrams: string[] = []

    for (const token of tokens) {
      // If token is shorter than minGram, include it as-is if it meets minGram
      if (token.length < this.minGram) {
        continue
      }

      // Generate n-grams of each size
      for (let n = this.minGram; n <= this.maxGram; n++) {
        if (n > token.length) continue

        for (let i = 0; i <= token.length - n; i++) {
          ngrams.push(token.slice(i, i + n))
        }
      }
    }

    return ngrams
  }

  /**
   * Tokenize with position information
   */
  tokenizeWithPositions(text: string): TokenWithPosition[] {
    const ngrams = this.tokenize(text)
    return ngrams.map((token, index) => ({
      token,
      position: index,
    }))
  }
}

// ============================================================================
// EdgeNgramAnalyzer
// ============================================================================

/**
 * Edge n-gram analyzer for autocomplete
 *
 * Generates n-grams starting from the beginning of each token.
 * For example, "test" with minGram=1, maxGram=4 produces:
 * ["t", "te", "tes", "test"]
 */
export class EdgeNgramAnalyzer implements Analyzer {
  private minGram: number
  private maxGram: number
  private baseAnalyzer: StandardAnalyzer

  constructor(options: EdgeNgramAnalyzerOptions = {}) {
    this.minGram = options.minGram ?? 1
    this.maxGram = options.maxGram ?? 20
    this.baseAnalyzer = new StandardAnalyzer()
  }

  /**
   * Generate edge n-grams for text
   */
  tokenize(text: string): string[] {
    // First tokenize with standard analyzer
    const tokens = this.baseAnalyzer.tokenize(text)

    // Generate edge n-grams for each token
    const edgeNgrams: string[] = []

    for (const token of tokens) {
      // Skip tokens shorter than minGram
      if (token.length < this.minGram) {
        continue
      }

      // Generate edge n-grams from start of token
      const maxLen = Math.min(this.maxGram, token.length)
      for (let n = this.minGram; n <= maxLen; n++) {
        edgeNgrams.push(token.slice(0, n))
      }
    }

    return edgeNgrams
  }

  /**
   * Tokenize with position information
   */
  tokenizeWithPositions(text: string): TokenWithPosition[] {
    const ngrams = this.tokenize(text)
    return ngrams.map((token, index) => ({
      token,
      position: index,
    }))
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an analyzer from options
 *
 * @param options - Analyzer options including type
 * @returns Configured analyzer instance
 */
export function createAnalyzer(options: AnalyzerOptions = {}): Analyzer {
  const type = options.type ?? 'standard'

  switch (type) {
    case 'standard':
      return new StandardAnalyzer({
        minTokenLength: options.minTokenLength,
        maxTokenLength: options.maxTokenLength,
        stopWords: options.stopWords,
      })

    case 'ngram':
      return new NgramAnalyzer({
        minGram: options.minGram,
        maxGram: options.maxGram,
      })

    case 'edge_ngram':
      return new EdgeNgramAnalyzer({
        minGram: options.minGram,
        maxGram: options.maxGram,
      })

    default:
      throw new Error(`Unknown analyzer type: ${type}`)
  }
}
