/**
 * Language Detection Tests (RED Phase)
 *
 * Tests for detecting the programming language of input strings.
 * This enables multi-language shell support for bashx.
 *
 * Detection priority (highest to lowest confidence):
 * 1. Shebang (#!/usr/bin/env python3) - confidence ~0.95
 * 2. Interpreter command (python script.py) - confidence ~0.90
 * 3. File extension (.py, .rb, .js) - confidence ~0.85
 * 4. Syntax patterns (def, import, puts) - confidence ~0.60-0.75
 * 5. Default to bash - confidence ~0.50
 *
 * These tests are expected to FAIL initially (RED phase).
 * The detectLanguage implementation will be done in the GREEN phase.
 *
 * Total: 22 tests
 * - Shebang: 5 tests
 * - Interpreter: 6 tests
 * - Extension: 5 tests
 * - Syntax: 6 tests
 */

import { describe, it, expect } from 'vitest'

import {
  detectLanguage,
  CONFIDENCE,
  type SupportedLanguage,
  type LanguageDetectionResult,
} from './language-detector.js'

describe('Language Detection', () => {
  // ==========================================================================
  // Shebang Detection (5 tests)
  // Highest confidence (~0.95) - explicit language declaration
  // ==========================================================================
  describe('Shebang Detection', () => {
    it('should detect python3 from shebang', () => {
      const result = detectLanguage('#!/usr/bin/env python3\nprint("hello")')

      expect(result.language).toBe('python')
      expect(result.method).toBe('shebang')
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.details.runtime).toBe('python3')
    })

    it('should detect ruby from shebang', () => {
      const result = detectLanguage('#!/usr/bin/env ruby\nputs "hello"')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('shebang')
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.details.runtime).toBe('ruby')
    })

    it('should detect node from shebang', () => {
      const result = detectLanguage('#!/usr/bin/env node\nconsole.log("hello")')

      expect(result.language).toBe('node')
      expect(result.method).toBe('shebang')
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.details.runtime).toBe('node')
    })

    it('should detect bash from shebang', () => {
      const result = detectLanguage('#!/bin/bash\necho "hello"')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('shebang')
      expect(result.confidence).toBeGreaterThanOrEqual(0.95)
      expect(result.details.runtime).toBe('bash')
    })

    it('should extract version from python shebang', () => {
      const result = detectLanguage('#!/usr/bin/python3.11\nprint("versioned")')

      expect(result.language).toBe('python')
      expect(result.method).toBe('shebang')
      expect(result.details.runtime).toBe('python3.11')
    })
  })

  // ==========================================================================
  // Interpreter Detection (6 tests)
  // High confidence (~0.90) - interpreter command invocation
  // ==========================================================================
  describe('Interpreter Detection', () => {
    it('should detect python from interpreter command', () => {
      const result = detectLanguage('python script.py')

      expect(result.language).toBe('python')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
      expect(result.details.file).toBe('script.py')
    })

    it('should detect python from inline -c flag', () => {
      const result = detectLanguage('python -c "print(42)"')

      expect(result.language).toBe('python')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
      expect(result.details.inline).toBe(true)
    })

    it('should detect ruby from inline -e flag', () => {
      const result = detectLanguage('ruby -e "puts 42"')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
      expect(result.details.inline).toBe(true)
    })

    it('should detect node from --eval flag', () => {
      const result = detectLanguage('node --eval "console.log(42)"')

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
      expect(result.details.inline).toBe(true)
    })

    it('should detect go from go run command', () => {
      const result = detectLanguage('go run main.go')

      expect(result.language).toBe('go')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
      expect(result.details.file).toBe('main.go')
    })

    it('should detect rust from cargo run command', () => {
      const result = detectLanguage('cargo run')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('interpreter')
      expect(result.confidence).toBeGreaterThanOrEqual(0.90)
    })
  })

  // ==========================================================================
  // Extension Detection (5 tests)
  // Medium confidence (~0.85) - file extension inference
  // ==========================================================================
  describe('Extension Detection', () => {
    it('should detect python from .py file', () => {
      const result = detectLanguage('./analyze.py')

      expect(result.language).toBe('python')
      expect(result.method).toBe('extension')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.details.file).toBe('./analyze.py')
    })

    it('should detect ruby from .rb file', () => {
      const result = detectLanguage('./server.rb')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('extension')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.details.file).toBe('./server.rb')
    })

    it('should detect node from .js file', () => {
      const result = detectLanguage('./build.js')

      expect(result.language).toBe('node')
      expect(result.method).toBe('extension')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.details.file).toBe('./build.js')
    })

    it('should detect go from .go file', () => {
      const result = detectLanguage('./main.go')

      expect(result.language).toBe('go')
      expect(result.method).toBe('extension')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.details.file).toBe('./main.go')
    })

    it('should detect rust from .rs file', () => {
      const result = detectLanguage('./lib.rs')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('extension')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.details.file).toBe('./lib.rs')
    })
  })

  // ==========================================================================
  // Syntax Detection (6 tests, includes bash default)
  // Lower confidence (~0.60-0.75) - syntax pattern recognition
  // Default to bash (~0.50) when no patterns match
  // ==========================================================================
  describe('Syntax Detection', () => {
    it('should detect python from def keyword', () => {
      const result = detectLanguage('def hello():\n  print("world")')

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
      expect(result.confidence).toBeGreaterThanOrEqual(0.60)
      expect(result.confidence).toBeLessThanOrEqual(0.80)
    })

    it('should detect python from import statement', () => {
      const result = detectLanguage('import os\nprint(os.getcwd())')

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
      expect(result.confidence).toBeGreaterThanOrEqual(0.60)
      expect(result.confidence).toBeLessThanOrEqual(0.80)
    })

    it('should detect ruby from puts keyword', () => {
      const result = detectLanguage('puts "hello world"')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
      expect(result.confidence).toBeGreaterThanOrEqual(0.60)
      expect(result.confidence).toBeLessThanOrEqual(0.80)
    })

    it('should detect ruby from end keyword', () => {
      const result = detectLanguage('def hello\n  puts "hi"\nend')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
      expect(result.confidence).toBeGreaterThanOrEqual(0.60)
      expect(result.confidence).toBeLessThanOrEqual(0.80)
    })

    it('should detect node from const/async keywords', () => {
      // Test with const
      const constResult = detectLanguage('const x = 42\nconsole.log(x)')
      expect(constResult.language).toBe('node')
      expect(constResult.method).toBe('syntax')
      expect(constResult.confidence).toBeGreaterThanOrEqual(0.60)
      expect(constResult.confidence).toBeLessThanOrEqual(0.80)

      // Test with async
      const asyncResult = detectLanguage('async function fetch() { await api.get() }')
      expect(asyncResult.language).toBe('node')
      expect(asyncResult.method).toBe('syntax')
      expect(asyncResult.confidence).toBeGreaterThanOrEqual(0.60)
      expect(asyncResult.confidence).toBeLessThanOrEqual(0.80)
    })

    it('should default to bash when no patterns match', () => {
      const result = detectLanguage('echo "hello world"')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('default')
      expect(result.confidence).toBe(0.50)
    })
  })

  // ==========================================================================
  // Confidence Constants (7 tests)
  // Verify that confidence constants are exported and have correct values
  // ==========================================================================
  describe('Confidence Constants', () => {
    it('should export CONFIDENCE object', () => {
      expect(CONFIDENCE).toBeDefined()
      expect(typeof CONFIDENCE).toBe('object')
    })

    it('should have SHEBANG confidence of 0.95', () => {
      expect(CONFIDENCE.SHEBANG).toBe(0.95)
    })

    it('should have INTERPRETER confidence of 0.90', () => {
      expect(CONFIDENCE.INTERPRETER).toBe(0.90)
    })

    it('should have EXTENSION confidence of 0.85', () => {
      expect(CONFIDENCE.EXTENSION).toBe(0.85)
    })

    it('should have syntax confidence levels in correct range', () => {
      expect(CONFIDENCE.SYNTAX_HIGH).toBe(0.75)
      expect(CONFIDENCE.SYNTAX_MEDIUM).toBe(0.70)
      expect(CONFIDENCE.SYNTAX_LOW).toBe(0.65)
      expect(CONFIDENCE.SYNTAX_LOWER).toBe(0.60)
      expect(CONFIDENCE.SYNTAX_LOWEST).toBe(0.55)
    })

    it('should have DEFAULT confidence of 0.50', () => {
      expect(CONFIDENCE.DEFAULT).toBe(0.50)
    })

    it('should use constants in detection results', () => {
      // Shebang detection should use CONFIDENCE.SHEBANG
      const shebangResult = detectLanguage('#!/usr/bin/env python3\nprint("hello")')
      expect(shebangResult.confidence).toBe(CONFIDENCE.SHEBANG)

      // Interpreter detection should use CONFIDENCE.INTERPRETER
      const interpreterResult = detectLanguage('python script.py')
      expect(interpreterResult.confidence).toBe(CONFIDENCE.INTERPRETER)

      // Extension detection should use CONFIDENCE.EXTENSION
      const extensionResult = detectLanguage('./analyze.py')
      expect(extensionResult.confidence).toBe(CONFIDENCE.EXTENSION)

      // Default detection should use CONFIDENCE.DEFAULT
      const defaultResult = detectLanguage('echo "hello"')
      expect(defaultResult.confidence).toBe(CONFIDENCE.DEFAULT)
    })
  })
})
