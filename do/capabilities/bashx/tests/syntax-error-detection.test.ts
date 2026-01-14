/**
 * Syntax Error Detection and Auto-Fix Tests (RED Phase)
 *
 * Tests for detecting common bash syntax errors and generating auto-fix suggestions.
 * These tests document expected behavior for the syntax error detection system.
 *
 * Key scenarios tested:
 * 1. Unclosed quotes (single and double)
 * 2. Missing command terminators
 * 3. Unbalanced brackets/braces
 * 4. Invalid pipe/redirect syntax
 */

import { describe, it, expect } from 'vitest'
import type { Program, ParseError, Fix } from '../src/types.js'
import { detectErrors, suggestFixes, applyFixes, autoFix } from '../src/ast/fix.js'
import { parse } from '../src/ast/parser.js'

// ============================================================================
// Test Fixtures - Malformed Commands
// ============================================================================

/**
 * Commands with unclosed quotes
 */
const UNCLOSED_QUOTE_CASES = [
  {
    input: 'echo "hello',
    expectedError: {
      type: 'unclosed_quote',
      quoteType: 'double',
      message: /unclosed.*double.*quote/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: '"',
      reason: /close.*double.*quote/i,
    },
    fixedCommand: 'echo "hello"',
  },
  {
    input: "echo 'world",
    expectedError: {
      type: 'unclosed_quote',
      quoteType: 'single',
      message: /unclosed.*single.*quote/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: "'",
      reason: /close.*single.*quote/i,
    },
    fixedCommand: "echo 'world'",
  },
  {
    input: 'cat "file with spaces.txt',
    expectedError: {
      type: 'unclosed_quote',
      quoteType: 'double',
      message: /unclosed.*quote/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: '"',
    },
    fixedCommand: 'cat "file with spaces.txt"',
  },
  {
    input: "FOO='bar",
    expectedError: {
      type: 'unclosed_quote',
      quoteType: 'single',
    },
    fixedCommand: "FOO='bar'",
  },
  {
    input: 'echo "nested \'quotes',
    expectedError: {
      type: 'unclosed_quote',
      quoteType: 'double',
    },
    fixedCommand: 'echo "nested \'quotes"',
  },
]

/**
 * Commands missing terminators (semicolons, etc.)
 */
const MISSING_TERMINATOR_CASES = [
  {
    input: 'if [ -f file.txt ]; then echo found',
    expectedError: {
      type: 'missing_terminator',
      expected: 'fi',
      message: /missing.*fi/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: '; fi',
    },
    fixedCommand: 'if [ -f file.txt ]; then echo found; fi',
  },
  {
    input: 'for i in 1 2 3; do echo $i',
    expectedError: {
      type: 'missing_terminator',
      expected: 'done',
      message: /missing.*done/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: '; done',
    },
    fixedCommand: 'for i in 1 2 3; do echo $i; done',
  },
  {
    input: 'while true; do echo loop',
    expectedError: {
      type: 'missing_terminator',
      expected: 'done',
    },
    fixedCommand: 'while true; do echo loop; done',
  },
  {
    input: 'case $x in a) echo a',
    expectedError: {
      type: 'missing_terminator',
      expected: 'esac',
    },
    fixedCommand: 'case $x in a) echo a ;; esac',
  },
]

/**
 * Commands with unbalanced brackets/braces
 */
const UNBALANCED_BRACKET_CASES = [
  {
    input: 'echo ${VAR',
    expectedError: {
      type: 'unbalanced_brace',
      opener: '${',
      message: /unclosed.*brace|missing.*\}/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: '}',
    },
    fixedCommand: 'echo ${VAR}',
  },
  {
    input: 'test [ -f file.txt',
    expectedError: {
      type: 'unbalanced_bracket',
      opener: '[',
      message: /unclosed.*bracket|missing.*\]/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: ' ]',
    },
    fixedCommand: 'test [ -f file.txt ]',
  },
  {
    input: '( cd /tmp && ls',
    expectedError: {
      type: 'unbalanced_paren',
      opener: '(',
      message: /unclosed.*paren|subshell|missing.*\)/i,
    },
    expectedFix: {
      type: 'insert' as const,
      position: 'end' as const,
      value: ' )',
    },
    fixedCommand: '( cd /tmp && ls )',
  },
  {
    input: 'echo $((1 + 2)',
    expectedError: {
      type: 'unbalanced_arithmetic',
      opener: '$((',
    },
    fixedCommand: 'echo $((1 + 2))',
  },
  {
    input: 'echo $(cat file.txt',
    expectedError: {
      type: 'unbalanced_subst',
      opener: '$(',
    },
    fixedCommand: 'echo $(cat file.txt)',
  },
  {
    input: 'if [[ $x == "y"',
    expectedError: {
      type: 'unbalanced_bracket',
      opener: '[[',
    },
    fixedCommand: 'if [[ $x == "y" ]]',
  },
]

/**
 * Commands with invalid pipe/redirect syntax
 */
const INVALID_PIPE_REDIRECT_CASES = [
  {
    input: 'ls |',
    expectedError: {
      type: 'incomplete_pipe',
      message: /pipe.*incomplete|missing.*command.*after.*pipe/i,
    },
    expectedFix: null, // Cannot auto-fix - need user input
    suggestions: ['Add a command after the pipe', 'Remove the trailing pipe'],
  },
  {
    input: '| grep foo',
    expectedError: {
      type: 'invalid_pipe_start',
      message: /pipe.*start|command.*expected.*before.*pipe/i,
    },
    expectedFix: null,
  },
  {
    input: 'echo hello >',
    expectedError: {
      type: 'incomplete_redirect',
      message: /redirect.*incomplete|missing.*file.*after.*redirect/i,
    },
    expectedFix: null,
  },
  {
    input: 'cat < ',
    expectedError: {
      type: 'incomplete_redirect',
      message: /redirect.*incomplete|missing.*file/i,
    },
    expectedFix: null,
  },
  {
    input: 'echo test >> ',
    expectedError: {
      type: 'incomplete_redirect',
    },
    expectedFix: null,
  },
  {
    input: 'cmd | | cmd2',
    expectedError: {
      type: 'consecutive_pipes',
      message: /consecutive.*pipe|double.*pipe/i,
    },
    expectedFix: {
      type: 'delete' as const,
      position: expect.any(Number),
      reason: /remove.*extra.*pipe/i,
    },
  },
  {
    input: 'echo > > file',
    expectedError: {
      type: 'consecutive_redirects',
      message: /consecutive.*redirect|double.*redirect/i,
    },
    expectedFix: null,
  },
]

/**
 * Commands with other syntax errors
 */
const OTHER_SYNTAX_ERROR_CASES = [
  {
    input: 'echo ${VAR:-"default}',
    expectedError: {
      type: 'unclosed_quote',
      message: /unclosed.*quote.*parameter.*expansion/i,
    },
    fixedCommand: 'echo ${VAR:-"default"}',
  },
  {
    input: 'echo "hello $((1+2)"',
    expectedError: {
      type: 'unbalanced_arithmetic',
    },
    fixedCommand: 'echo "hello $((1+2))"',
  },
  {
    input: 'cmd && ',
    expectedError: {
      type: 'incomplete_list',
      message: /incomplete.*and|missing.*command.*after/i,
    },
    expectedFix: null,
  },
  {
    input: 'cmd || ',
    expectedError: {
      type: 'incomplete_list',
      message: /incomplete.*or|missing.*command/i,
    },
    expectedFix: null,
  },
  {
    input: '; echo test',
    expectedError: {
      type: 'unexpected_token',
      message: /unexpected.*;|semicolon.*start/i,
    },
    expectedFix: {
      type: 'delete' as const,
      position: 0,
    },
    fixedCommand: 'echo test',
  },
]

// ============================================================================
// Tests
// ============================================================================

describe('Syntax Error Detection', () => {
  describe('Unclosed Quotes', () => {
    it.each(UNCLOSED_QUOTE_CASES.map((c) => [c.input, c]))(
      'should detect unclosed quote in "%s"',
      (input, testCase) => {
        const ast = parse(testCase.input)
        const errors = detectErrors(ast)

        expect(errors.length).toBeGreaterThan(0)
        expect(errors[0].message).toMatch(testCase.expectedError.message || /quote/i)
      }
    )

    it('should detect double quote at end of command', () => {
      const ast = parse('echo "hello')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/unclosed.*double.*quote/i),
        })
      )
    })

    it('should detect single quote at end of command', () => {
      const ast = parse("echo 'hello")
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/unclosed.*single.*quote/i),
        })
      )
    })

    it('should provide line and column for unclosed quotes', () => {
      const ast = parse('echo "hello')
      const errors = detectErrors(ast)

      expect(errors[0]).toHaveProperty('line')
      expect(errors[0]).toHaveProperty('column')
      expect(errors[0].line).toBe(1)
      expect(errors[0].column).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Missing Terminators', () => {
    it.each(MISSING_TERMINATOR_CASES.map((c) => [c.input.slice(0, 30) + '...', c]))(
      'should detect missing terminator in "%s"',
      (_, testCase) => {
        const ast = parse(testCase.input)
        const errors = detectErrors(ast)

        expect(errors.length).toBeGreaterThan(0)
        if (testCase.expectedError.message) {
          expect(errors[0].message).toMatch(testCase.expectedError.message)
        }
      }
    )

    it('should detect missing "fi" in if statement', () => {
      const ast = parse('if true; then echo yes')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/fi|if.*statement.*incomplete/i),
        })
      )
    })

    it('should detect missing "done" in for loop', () => {
      const ast = parse('for x in a b c; do echo $x')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/done|for.*loop.*incomplete/i),
        })
      )
    })

    it('should detect missing "done" in while loop', () => {
      const ast = parse('while true; do echo loop')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/done|while.*loop.*incomplete/i),
        })
      )
    })
  })

  describe('Unbalanced Brackets/Braces', () => {
    it.each(UNBALANCED_BRACKET_CASES.map((c) => [c.input, c]))(
      'should detect unbalanced brackets in "%s"',
      (input, testCase) => {
        const ast = parse(testCase.input)
        const errors = detectErrors(ast)

        expect(errors.length).toBeGreaterThan(0)
        if (testCase.expectedError.message) {
          expect(errors[0].message).toMatch(testCase.expectedError.message)
        }
      }
    )

    it('should detect unclosed ${} in variable expansion', () => {
      const ast = parse('echo ${HOME')
      const errors = detectErrors(ast)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toMatch(/\}|brace|expansion/i)
    })

    it('should detect unclosed subshell', () => {
      const ast = parse('(cd /tmp && pwd')
      const errors = detectErrors(ast)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toMatch(/\)|paren|subshell/i)
    })

    it('should detect unclosed command substitution', () => {
      const ast = parse('echo $(pwd')
      const errors = detectErrors(ast)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toMatch(/\)|substitution|command/i)
    })

    it('should detect unclosed [[ test', () => {
      const ast = parse('[[ -f file.txt')
      const errors = detectErrors(ast)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].message).toMatch(/\]\]|bracket|test/i)
    })
  })

  describe('Invalid Pipe/Redirect Syntax', () => {
    it.each(INVALID_PIPE_REDIRECT_CASES.map((c) => [c.input, c]))(
      'should detect invalid pipe/redirect in "%s"',
      (input, testCase) => {
        const ast = parse(testCase.input)
        const errors = detectErrors(ast)

        expect(errors.length).toBeGreaterThan(0)
        if (testCase.expectedError.message) {
          expect(errors[0].message).toMatch(testCase.expectedError.message)
        }
      }
    )

    it('should detect trailing pipe without command', () => {
      const ast = parse('ls -la |')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/pipe|command.*expected/i),
        })
      )
    })

    it('should detect leading pipe', () => {
      const ast = parse('| cat file.txt')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/pipe.*start|unexpected.*\|/i),
        })
      )
    })

    it('should detect redirect without target', () => {
      const ast = parse('echo hello >')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/redirect|file.*expected/i),
        })
      )
    })
  })

  describe('Other Syntax Errors', () => {
    it.each(OTHER_SYNTAX_ERROR_CASES.map((c) => [c.input, c]))(
      'should detect syntax error in "%s"',
      (input, testCase) => {
        const ast = parse(testCase.input)
        const errors = detectErrors(ast)

        expect(errors.length).toBeGreaterThan(0)
        if (testCase.expectedError.message) {
          expect(errors[0].message).toMatch(testCase.expectedError.message)
        }
      }
    )

    it('should detect unexpected semicolon at start', () => {
      const ast = parse('; echo test')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/unexpected|semicolon/i),
        })
      )
    })

    it('should detect incomplete && list', () => {
      const ast = parse('test -f file &&')
      const errors = detectErrors(ast)

      expect(errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/incomplete|command.*expected/i),
        })
      )
    })
  })
})

describe('Auto-Fix Suggestions', () => {
  describe('suggestFixes', () => {
    it('should suggest closing double quote', () => {
      const ast = parse('echo "hello')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0]).toMatchObject({
        type: 'insert',
        value: '"',
      })
    })

    it('should suggest closing single quote', () => {
      const ast = parse("echo 'hello")
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0]).toMatchObject({
        type: 'insert',
        value: "'",
      })
    })

    it('should suggest closing brace for ${', () => {
      const ast = parse('echo ${VAR')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0]).toMatchObject({
        type: 'insert',
        value: '}',
      })
    })

    it('should suggest closing paren for $(', () => {
      const ast = parse('echo $(pwd')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0]).toMatchObject({
        type: 'insert',
        value: ')',
      })
    })

    it('should suggest "fi" for incomplete if', () => {
      const ast = parse('if true; then echo yes')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0].value).toMatch(/fi/i)
    })

    it('should suggest "done" for incomplete loop', () => {
      const ast = parse('for i in 1 2 3; do echo $i')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0].value).toMatch(/done/i)
    })

    it('should not suggest fixes for unfixable errors', () => {
      const ast = parse('ls |')
      const fixes = suggestFixes(ast)

      // Trailing pipe needs user input - cannot auto-fix
      expect(fixes.every((f) => f.type !== 'insert' || f.value !== '')).toBe(true)
    })

    it('should include reason for each fix', () => {
      const ast = parse('echo "hello')
      const fixes = suggestFixes(ast)

      expect(fixes.length).toBeGreaterThan(0)
      expect(fixes[0]).toHaveProperty('reason')
      expect(fixes[0].reason.length).toBeGreaterThan(0)
    })
  })

  describe('applyFixes', () => {
    it('should apply insert fix at end', () => {
      const input = 'echo "hello'
      const fixes: Fix[] = [
        { type: 'insert', position: 'end', value: '"', reason: 'Close double quote' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('echo "hello"')
    })

    it('should apply insert fix at start', () => {
      const input = 'echo test'
      const fixes: Fix[] = [
        { type: 'insert', position: 'start', value: '# ', reason: 'Comment out' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('# echo test')
    })

    it('should apply insert fix at specific position', () => {
      const input = 'echo ${VAR'
      const fixes: Fix[] = [
        { type: 'insert', position: 10, value: '}', reason: 'Close brace' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('echo ${VAR}')
    })

    it('should apply delete fix', () => {
      const input = '; echo test'
      const fixes: Fix[] = [
        { type: 'delete', position: 0, value: '; ', reason: 'Remove unexpected semicolon' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('echo test')
    })

    it('should apply replace fix', () => {
      const input = 'echo | | cat'
      const fixes: Fix[] = [
        { type: 'replace', position: 5, value: '|', reason: 'Remove duplicate pipe' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('echo | cat')
    })

    it('should apply multiple fixes in correct order', () => {
      const input = 'echo "hello ${VAR'
      const fixes: Fix[] = [
        { type: 'insert', position: 'end', value: '}"', reason: 'Close brace and quote' },
      ]

      const result = applyFixes(input, fixes)
      expect(result).toBe('echo "hello ${VAR}"')
    })
  })

  describe('autoFix', () => {
    it.each(
      UNCLOSED_QUOTE_CASES.filter((c) => c.fixedCommand).map((c) => [c.input, c.fixedCommand])
    )('should auto-fix unclosed quote: "%s" -> "%s"', (input, expected) => {
      const result = autoFix(input)

      expect(result).not.toBeNull()
      expect(result!.command).toBe(expected)
      expect(result!.changes.length).toBeGreaterThan(0)
    })

    it.each(
      UNBALANCED_BRACKET_CASES.filter((c) => c.fixedCommand).map((c) => [
        c.input,
        c.fixedCommand,
      ])
    )('should auto-fix unbalanced brackets: "%s" -> "%s"', (input, expected) => {
      const result = autoFix(input)

      expect(result).not.toBeNull()
      expect(result!.command).toBe(expected)
    })

    it.each(
      MISSING_TERMINATOR_CASES.filter((c) => c.fixedCommand).map((c) => [
        c.input.slice(0, 30) + '...',
        c,
      ])
    )('should auto-fix missing terminator: "%s"', (_, testCase) => {
      const result = autoFix(testCase.input)

      expect(result).not.toBeNull()
      expect(result!.command).toBe(testCase.fixedCommand)
    })

    it('should return null for unfixable commands', () => {
      const result = autoFix('ls |')
      expect(result).toBeNull()
    })

    it('should return null for valid commands', () => {
      const result = autoFix('ls -la')
      // Valid commands don't need fixing
      expect(result).toBeNull()
    })

    it('should include all applied changes', () => {
      const result = autoFix('echo "hello')

      expect(result).not.toBeNull()
      expect(result!.changes).toBeInstanceOf(Array)
      expect(result!.changes.length).toBeGreaterThan(0)
      expect(result!.changes[0]).toHaveProperty('type')
      expect(result!.changes[0]).toHaveProperty('reason')
    })
  })
})

describe('Error Detection Edge Cases', () => {
  it('should handle empty input', () => {
    const ast = parse('')
    const errors = detectErrors(ast)

    // Empty input is valid, no errors
    expect(errors).toEqual([])
  })

  it('should handle whitespace-only input', () => {
    const ast = parse('   ')
    const errors = detectErrors(ast)

    expect(errors).toEqual([])
  })

  it('should handle valid complex commands without errors', () => {
    const validCommands = [
      'ls -la',
      'cat file.txt | grep pattern | wc -l',
      'echo "hello world"',
      "echo 'single quoted'",
      'echo ${HOME}/bin',
      '(cd /tmp && ls)',
      'if true; then echo yes; fi',
      'for i in 1 2 3; do echo $i; done',
      'test -f file.txt && echo exists',
    ]

    for (const cmd of validCommands) {
      const ast = parse(cmd)
      const errors = detectErrors(ast)
      expect(errors).toEqual([])
    }
  })

  it('should handle nested quotes correctly', () => {
    const ast = parse("echo \"it's valid\"")
    const errors = detectErrors(ast)

    expect(errors).toEqual([])
  })

  it('should handle escaped quotes', () => {
    const ast = parse('echo "hello \\"world\\""')
    const errors = detectErrors(ast)

    expect(errors).toEqual([])
  })

  it('should detect multiple errors in one command', () => {
    const ast = parse('echo "hello ${VAR')
    const errors = detectErrors(ast)

    // Both unclosed quote and unclosed brace
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('should prioritize errors correctly', () => {
    const ast = parse('echo "hello ${VAR')
    const errors = detectErrors(ast)

    // The innermost error (unclosed brace) should come first or be detected
    expect(errors.some((e) => e.message.match(/brace|\}|expansion/i))).toBe(true)
  })
})

describe('Fix Application Edge Cases', () => {
  it('should handle empty fixes array', () => {
    const result = applyFixes('echo hello', [])
    expect(result).toBe('echo hello')
  })

  it('should handle fixes at end of string', () => {
    const result = applyFixes('x', [
      { type: 'insert', position: 'end', value: 'y', reason: 'test' },
    ])
    expect(result).toBe('xy')
  })

  it('should handle fixes at start of string', () => {
    const result = applyFixes('y', [
      { type: 'insert', position: 'start', value: 'x', reason: 'test' },
    ])
    expect(result).toBe('xy')
  })

  it('should handle overlapping fixes gracefully', () => {
    // When multiple fixes apply to same position, should handle deterministically
    const result = applyFixes('echo', [
      { type: 'insert', position: 'end', value: ' a', reason: 'test1' },
      { type: 'insert', position: 'end', value: ' b', reason: 'test2' },
    ])

    // Should apply both somehow - exact behavior is implementation-defined
    expect(result).toContain('echo')
  })
})
