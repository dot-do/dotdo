/**
 * Text Analyzer Tests (RED Phase)
 *
 * Tests for configurable text analyzers including:
 * - Standard analyzer (lowercase, tokenize on whitespace/punctuation)
 * - N-gram analyzer (generate n-grams from tokens)
 * - Edge n-gram analyzer (generate n-grams from token start)
 *
 * @module db/primitives/inverted-index/tests/analyzers
 */

import { describe, it, expect } from 'vitest'
import {
  Analyzer,
  StandardAnalyzer,
  NgramAnalyzer,
  EdgeNgramAnalyzer,
  createAnalyzer,
  type AnalyzerOptions,
  type TokenWithPosition,
} from '../analyzers'

// ============================================================================
// StandardAnalyzer
// ============================================================================

describe('StandardAnalyzer', () => {
  describe('tokenize', () => {
    it('should convert text to lowercase', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('Hello World')
      expect(tokens).toEqual(['hello', 'world'])
    })

    it('should split on whitespace', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('one two three')
      expect(tokens).toEqual(['one', 'two', 'three'])
    })

    it('should split on punctuation', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('hello, world! how are you?')
      expect(tokens).toEqual(['hello', 'world', 'how', 'are', 'you'])
    })

    it('should handle multiple spaces and tabs', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('one   two\tthree')
      expect(tokens).toEqual(['one', 'two', 'three'])
    })

    it('should filter empty tokens', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('  one  two  ')
      expect(tokens).toEqual(['one', 'two'])
    })

    it('should handle numbers in tokens', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('product123 test456')
      expect(tokens).toEqual(['product123', 'test456'])
    })

    it('should handle unicode text', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('caf\u00e9 na\u00efve')
      expect(tokens).toContain('caf\u00e9')
      expect(tokens).toContain('na\u00efve')
    })

    it('should return empty array for empty string', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('')
      expect(tokens).toEqual([])
    })

    it('should return empty array for whitespace only', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenize('   ')
      expect(tokens).toEqual([])
    })
  })

  describe('tokenize with positions', () => {
    it('should return tokens with character positions', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenizeWithPositions('hello world')
      expect(tokens).toEqual([
        { token: 'hello', position: 0 },
        { token: 'world', position: 1 },
      ])
    })

    it('should track positions correctly with multiple tokens', () => {
      const analyzer = new StandardAnalyzer()
      const tokens = analyzer.tokenizeWithPositions('one two three four')
      expect(tokens.map((t) => t.position)).toEqual([0, 1, 2, 3])
    })
  })

  describe('options', () => {
    it('should respect minTokenLength option', () => {
      const analyzer = new StandardAnalyzer({ minTokenLength: 3 })
      const tokens = analyzer.tokenize('a to the one')
      expect(tokens).toEqual(['the', 'one'])
    })

    it('should respect maxTokenLength option', () => {
      const analyzer = new StandardAnalyzer({ maxTokenLength: 5 })
      const tokens = analyzer.tokenize('hi longer')
      expect(tokens).toEqual(['hi'])
    })

    it('should filter stop words when provided', () => {
      const analyzer = new StandardAnalyzer({
        stopWords: ['the', 'a', 'is', 'and'],
      })
      const tokens = analyzer.tokenize('the quick brown fox and a dog')
      expect(tokens).toEqual(['quick', 'brown', 'fox', 'dog'])
    })
  })
})

// ============================================================================
// NgramAnalyzer
// ============================================================================

describe('NgramAnalyzer', () => {
  describe('tokenize', () => {
    it('should generate bigrams (n=2)', () => {
      const analyzer = new NgramAnalyzer({ minGram: 2, maxGram: 2 })
      const tokens = analyzer.tokenize('test')
      expect(tokens).toEqual(['te', 'es', 'st'])
    })

    it('should generate trigrams (n=3)', () => {
      const analyzer = new NgramAnalyzer({ minGram: 3, maxGram: 3 })
      const tokens = analyzer.tokenize('test')
      expect(tokens).toEqual(['tes', 'est'])
    })

    it('should generate range of n-grams (min=2, max=4)', () => {
      const analyzer = new NgramAnalyzer({ minGram: 2, maxGram: 4 })
      const tokens = analyzer.tokenize('test')
      // n=2: te, es, st
      // n=3: tes, est
      // n=4: test
      expect(tokens).toContain('te')
      expect(tokens).toContain('es')
      expect(tokens).toContain('st')
      expect(tokens).toContain('tes')
      expect(tokens).toContain('est')
      expect(tokens).toContain('test')
    })

    it('should handle short strings', () => {
      const analyzer = new NgramAnalyzer({ minGram: 2, maxGram: 3 })
      const tokens = analyzer.tokenize('ab')
      expect(tokens).toEqual(['ab'])
    })

    it('should handle strings shorter than minGram', () => {
      const analyzer = new NgramAnalyzer({ minGram: 3, maxGram: 4 })
      const tokens = analyzer.tokenize('ab')
      expect(tokens).toEqual([])
    })

    it('should tokenize first and then generate n-grams for each token', () => {
      const analyzer = new NgramAnalyzer({ minGram: 2, maxGram: 2 })
      const tokens = analyzer.tokenize('ab cd')
      expect(tokens).toEqual(['ab', 'cd'])
    })

    it('should convert to lowercase before n-gram generation', () => {
      const analyzer = new NgramAnalyzer({ minGram: 2, maxGram: 2 })
      const tokens = analyzer.tokenize('TEST')
      expect(tokens).toEqual(['te', 'es', 'st'])
    })
  })

  describe('default options', () => {
    it('should use default minGram=2, maxGram=3', () => {
      const analyzer = new NgramAnalyzer()
      const tokens = analyzer.tokenize('test')
      expect(tokens).toContain('te')
      expect(tokens).toContain('tes')
    })
  })
})

// ============================================================================
// EdgeNgramAnalyzer
// ============================================================================

describe('EdgeNgramAnalyzer', () => {
  describe('tokenize', () => {
    it('should generate edge n-grams starting from beginning', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 1, maxGram: 4 })
      const tokens = analyzer.tokenize('test')
      expect(tokens).toEqual(['t', 'te', 'tes', 'test'])
    })

    it('should respect minGram', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 2, maxGram: 4 })
      const tokens = analyzer.tokenize('test')
      expect(tokens).toEqual(['te', 'tes', 'test'])
    })

    it('should respect maxGram', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 1, maxGram: 2 })
      const tokens = analyzer.tokenize('test')
      expect(tokens).toEqual(['t', 'te'])
    })

    it('should handle strings shorter than maxGram', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 1, maxGram: 10 })
      const tokens = analyzer.tokenize('abc')
      expect(tokens).toEqual(['a', 'ab', 'abc'])
    })

    it('should handle strings shorter than minGram', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 5, maxGram: 10 })
      const tokens = analyzer.tokenize('abc')
      expect(tokens).toEqual([])
    })

    it('should tokenize first and generate edge n-grams per token', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 1, maxGram: 3 })
      const tokens = analyzer.tokenize('ab cd')
      // From 'ab': a, ab
      // From 'cd': c, cd
      expect(tokens).toContain('a')
      expect(tokens).toContain('ab')
      expect(tokens).toContain('c')
      expect(tokens).toContain('cd')
    })

    it('should convert to lowercase', () => {
      const analyzer = new EdgeNgramAnalyzer({ minGram: 1, maxGram: 3 })
      const tokens = analyzer.tokenize('TEST')
      expect(tokens).toEqual(['t', 'te', 'tes'])
    })
  })

  describe('default options', () => {
    it('should use default minGram=1, maxGram=20', () => {
      const analyzer = new EdgeNgramAnalyzer()
      const tokens = analyzer.tokenize('test')
      expect(tokens[0]).toBe('t')
      expect(tokens[tokens.length - 1]).toBe('test')
    })
  })
})

// ============================================================================
// createAnalyzer Factory
// ============================================================================

describe('createAnalyzer factory', () => {
  it('should create StandardAnalyzer by default', () => {
    const analyzer = createAnalyzer()
    expect(analyzer).toBeInstanceOf(StandardAnalyzer)
  })

  it('should create StandardAnalyzer with type="standard"', () => {
    const analyzer = createAnalyzer({ type: 'standard' })
    expect(analyzer).toBeInstanceOf(StandardAnalyzer)
  })

  it('should create NgramAnalyzer with type="ngram"', () => {
    const analyzer = createAnalyzer({ type: 'ngram', minGram: 2, maxGram: 4 })
    expect(analyzer).toBeInstanceOf(NgramAnalyzer)
  })

  it('should create EdgeNgramAnalyzer with type="edge_ngram"', () => {
    const analyzer = createAnalyzer({ type: 'edge_ngram', minGram: 1, maxGram: 10 })
    expect(analyzer).toBeInstanceOf(EdgeNgramAnalyzer)
  })

  it('should pass options to analyzer', () => {
    const analyzer = createAnalyzer({
      type: 'standard',
      minTokenLength: 3,
      stopWords: ['the'],
    })
    const tokens = analyzer.tokenize('the one')
    expect(tokens).toEqual(['one'])
  })
})

// ============================================================================
// Analyzer Interface
// ============================================================================

describe('Analyzer interface', () => {
  it('all analyzers should implement Analyzer interface', () => {
    const analyzers: Analyzer[] = [
      new StandardAnalyzer(),
      new NgramAnalyzer(),
      new EdgeNgramAnalyzer(),
    ]

    for (const analyzer of analyzers) {
      expect(typeof analyzer.tokenize).toBe('function')
      expect(typeof analyzer.tokenizeWithPositions).toBe('function')
    }
  })

  it('tokenizeWithPositions should be consistent with tokenize', () => {
    const analyzer = new StandardAnalyzer()
    const text = 'hello world test'
    const tokens = analyzer.tokenize(text)
    const tokensWithPos = analyzer.tokenizeWithPositions(text)

    expect(tokensWithPos.map((t) => t.token)).toEqual(tokens)
  })
})
