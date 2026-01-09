/**
 * TDD RED Phase - Tests for code vs natural language detection
 *
 * These tests verify the looksLikeCode() function which uses heuristics
 * to detect whether user input is code or natural language.
 *
 * @see cli/utils/detect.ts (not yet implemented)
 */

import { describe, it, expect } from 'vitest'
import { looksLikeCode } from '../utils/detect'

describe('looksLikeCode', () => {
  describe('arithmetic expressions → code', () => {
    it('detects simple arithmetic as code', () => {
      expect(looksLikeCode('1 + 1')).toBe(true)
    })

    it('detects complex arithmetic as code', () => {
      expect(looksLikeCode('(5 * 3) + (10 / 2)')).toBe(true)
    })

    it('detects arithmetic with variables as code', () => {
      expect(looksLikeCode('x + y * 2')).toBe(true)
    })
  })

  describe('arrow functions → code', () => {
    it('detects simple arrow function as code', () => {
      expect(looksLikeCode('x => x * 2')).toBe(true)
    })

    it('detects arrow function with parens as code', () => {
      expect(looksLikeCode('(x, y) => x + y')).toBe(true)
    })

    it('detects arrow function with block body as code', () => {
      expect(looksLikeCode('x => { return x * 2 }')).toBe(true)
    })
  })

  describe('method calls → code', () => {
    it('detects Math method calls as code', () => {
      expect(looksLikeCode('Math.sqrt(16)')).toBe(true)
    })

    it('detects console method calls as code', () => {
      expect(looksLikeCode('console.log("hello")')).toBe(true)
    })

    it('detects chained method calls as code', () => {
      expect(looksLikeCode('str.trim().toLowerCase()')).toBe(true)
    })

    it('detects JSON method calls as code', () => {
      expect(looksLikeCode('JSON.parse(data)')).toBe(true)
    })
  })

  describe('return statements → code', () => {
    it('detects return with filter as code', () => {
      expect(looksLikeCode('return items.filter(x => x > 0)')).toBe(true)
    })

    it('detects simple return as code', () => {
      expect(looksLikeCode('return 42')).toBe(true)
    })

    it('detects return with object as code', () => {
      expect(looksLikeCode('return { status: "ok" }')).toBe(true)
    })
  })

  describe('variable declarations → code', () => {
    it('detects const declaration as code', () => {
      expect(looksLikeCode('const x = 5')).toBe(true)
    })

    it('detects let declaration as code', () => {
      expect(looksLikeCode('let count = 0')).toBe(true)
    })

    it('detects var declaration as code', () => {
      expect(looksLikeCode('var name = "test"')).toBe(true)
    })
  })

  describe('function declarations → code', () => {
    it('detects function declaration as code', () => {
      expect(looksLikeCode('function foo() {}')).toBe(true)
    })

    it('detects async function as code', () => {
      expect(looksLikeCode('async function fetchData() {}')).toBe(true)
    })

    it('detects function expression as code', () => {
      expect(looksLikeCode('const fn = function() { return 1 }')).toBe(true)
    })
  })

  describe('array operations → code', () => {
    it('detects array method chain as code', () => {
      expect(looksLikeCode('[1, 2, 3].map(x => x * 2)')).toBe(true)
    })

    it('detects array filter as code', () => {
      expect(looksLikeCode('arr.filter(item => item.active)')).toBe(true)
    })

    it('detects array reduce as code', () => {
      expect(looksLikeCode('nums.reduce((a, b) => a + b, 0)')).toBe(true)
    })
  })

  describe('natural language → not code', () => {
    it('detects "create a new user" as natural language', () => {
      expect(looksLikeCode('create a new user')).toBe(false)
    })

    it('detects "list startup ideas" as natural language', () => {
      expect(looksLikeCode('list startup ideas')).toBe(false)
    })

    it('detects "deploy the app" as natural language', () => {
      expect(looksLikeCode('deploy the app')).toBe(false)
    })

    it('detects "help me understand this error" as natural language', () => {
      expect(looksLikeCode('help me understand this error')).toBe(false)
    })

    it('detects "what is the weather" as natural language', () => {
      expect(looksLikeCode('what is the weather')).toBe(false)
    })

    it('detects questions as natural language', () => {
      expect(looksLikeCode('how do I install this package?')).toBe(false)
    })

    it('detects commands as natural language', () => {
      expect(looksLikeCode('run the tests')).toBe(false)
    })

    it('detects descriptions as natural language', () => {
      expect(looksLikeCode('a function that validates email addresses')).toBe(
        false
      )
    })
  })

  describe('edge cases', () => {
    it('handles ambiguous input "sum 1 2 3"', () => {
      // This could be interpreted as either code or natural language
      // Implementation should pick a reasonable default
      const result = looksLikeCode('sum 1 2 3')
      expect(typeof result).toBe('boolean')
    })

    it('handles empty string', () => {
      expect(looksLikeCode('')).toBe(false)
    })

    it('handles whitespace-only input', () => {
      expect(looksLikeCode('   ')).toBe(false)
    })

    it('handles single word that could be code', () => {
      // "null" could be a keyword or just text
      const result = looksLikeCode('null')
      expect(typeof result).toBe('boolean')
    })

    it('handles single word that is clearly natural language', () => {
      expect(looksLikeCode('hello')).toBe(false)
    })

    it('handles code-like words in natural language context', () => {
      expect(looksLikeCode('please return the results')).toBe(false)
    })

    it('handles mixed content', () => {
      // Natural language with code-like terms
      expect(looksLikeCode('explain what console.log does')).toBe(false)
    })
  })

  describe('additional code patterns', () => {
    it('detects object literals as code', () => {
      expect(looksLikeCode('{ name: "test", value: 42 }')).toBe(true)
    })

    it('detects array literals as code', () => {
      expect(looksLikeCode('[1, 2, 3, 4, 5]')).toBe(true)
    })

    it('detects template literals as code', () => {
      expect(looksLikeCode('`Hello ${name}!`')).toBe(true)
    })

    it('detects ternary expressions as code', () => {
      expect(looksLikeCode('x > 0 ? "positive" : "negative"')).toBe(true)
    })

    it('detects comparison operators as code', () => {
      expect(looksLikeCode('a === b && c !== d')).toBe(true)
    })

    it('detects spread operator as code', () => {
      expect(looksLikeCode('[...arr, newItem]')).toBe(true)
    })

    it('detects destructuring as code', () => {
      expect(looksLikeCode('const { x, y } = point')).toBe(true)
    })

    it('detects await expressions as code', () => {
      expect(looksLikeCode('await fetch(url)')).toBe(true)
    })

    it('detects class declarations as code', () => {
      expect(looksLikeCode('class User extends Entity {}')).toBe(true)
    })

    it('detects import statements as code', () => {
      expect(looksLikeCode("import { foo } from 'bar'")).toBe(true)
    })
  })
})
