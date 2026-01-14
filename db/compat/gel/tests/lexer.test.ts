/**
 * EdgeQL Lexer Tests - Token Specification
 *
 * TDD RED Phase: These tests define the complete contract for the EdgeQL lexer.
 * They specify all token types that must be recognized before implementation.
 *
 * The lexer module does NOT exist yet - these tests will fail until implemented.
 *
 * @see dotdo-jyxc6 - RED: EdgeQL Lexer - Token specification tests
 * @see db/compat/gel/spike-parser-findings.md - Parser approach evaluation
 */

import { describe, it, expect } from 'vitest'
import { tokenize, TokenType } from '../lexer'
import type { Token } from '../lexer-types'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to get just token types from tokenized output
 */
function tokenTypes(source: string): TokenType[] {
  return tokenize(source).map((t) => t.type)
}

/**
 * Helper to get token values
 */
function tokenValues(source: string): string[] {
  return tokenize(source).map((t) => t.value)
}

/**
 * Helper to find first token of a type
 */
function firstToken(source: string, type: TokenType): Token | undefined {
  return tokenize(source).find((t) => t.type === type)
}

// ============================================================================
// KEYWORD TESTS
// ============================================================================

describe('EdgeQL Lexer', () => {
  describe('keywords - statement types', () => {
    it('tokenizes SELECT keyword', () => {
      const tokens = tokenize('select')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[0].value).toBe('select')
    })

    it('tokenizes SELECT case-insensitively', () => {
      expect(tokenize('SELECT')[0].type).toBe(TokenType.SELECT)
      expect(tokenize('Select')[0].type).toBe(TokenType.SELECT)
      expect(tokenize('sElEcT')[0].type).toBe(TokenType.SELECT)
    })

    it('tokenizes INSERT keyword', () => {
      const tokens = tokenize('insert')
      expect(tokens[0].type).toBe(TokenType.INSERT)
    })

    it('tokenizes UPDATE keyword', () => {
      const tokens = tokenize('update')
      expect(tokens[0].type).toBe(TokenType.UPDATE)
    })

    it('tokenizes DELETE keyword', () => {
      const tokens = tokenize('delete')
      expect(tokens[0].type).toBe(TokenType.DELETE)
    })
  })

  describe('keywords - clauses', () => {
    it('tokenizes FILTER keyword', () => {
      expect(tokenize('filter')[0].type).toBe(TokenType.FILTER)
    })

    it('tokenizes ORDER keyword', () => {
      expect(tokenize('order')[0].type).toBe(TokenType.ORDER)
    })

    it('tokenizes BY keyword', () => {
      expect(tokenize('by')[0].type).toBe(TokenType.BY)
    })

    it('tokenizes LIMIT keyword', () => {
      expect(tokenize('limit')[0].type).toBe(TokenType.LIMIT)
    })

    it('tokenizes OFFSET keyword', () => {
      expect(tokenize('offset')[0].type).toBe(TokenType.OFFSET)
    })

    it('tokenizes WITH keyword', () => {
      expect(tokenize('with')[0].type).toBe(TokenType.WITH)
    })

    it('tokenizes FOR keyword', () => {
      expect(tokenize('for')[0].type).toBe(TokenType.FOR)
    })
  })

  describe('keywords - conditionals', () => {
    it('tokenizes IF keyword', () => {
      expect(tokenize('if')[0].type).toBe(TokenType.IF)
    })

    it('tokenizes ELSE keyword', () => {
      expect(tokenize('else')[0].type).toBe(TokenType.ELSE)
    })
  })

  describe('keywords - logical operators', () => {
    it('tokenizes AND keyword', () => {
      expect(tokenize('and')[0].type).toBe(TokenType.AND)
    })

    it('tokenizes OR keyword', () => {
      expect(tokenize('or')[0].type).toBe(TokenType.OR)
    })

    it('tokenizes NOT keyword', () => {
      expect(tokenize('not')[0].type).toBe(TokenType.NOT)
    })

    it('tokenizes IN keyword', () => {
      expect(tokenize('in')[0].type).toBe(TokenType.IN)
    })

    it('tokenizes LIKE keyword', () => {
      expect(tokenize('like')[0].type).toBe(TokenType.LIKE)
    })

    it('tokenizes ILIKE keyword', () => {
      expect(tokenize('ilike')[0].type).toBe(TokenType.ILIKE)
    })

    it('tokenizes IS keyword', () => {
      expect(tokenize('is')[0].type).toBe(TokenType.IS)
    })

    it('tokenizes EXISTS keyword', () => {
      expect(tokenize('exists')[0].type).toBe(TokenType.EXISTS)
    })
  })

  describe('keywords - set operations', () => {
    it('tokenizes DISTINCT keyword', () => {
      expect(tokenize('distinct')[0].type).toBe(TokenType.DISTINCT)
    })

    it('tokenizes UNION keyword', () => {
      expect(tokenize('union')[0].type).toBe(TokenType.UNION)
    })

    it('tokenizes INTERSECT keyword', () => {
      expect(tokenize('intersect')[0].type).toBe(TokenType.INTERSECT)
    })

    it('tokenizes EXCEPT keyword', () => {
      expect(tokenize('except')[0].type).toBe(TokenType.EXCEPT)
    })
  })

  describe('keywords - boolean literals', () => {
    it('tokenizes TRUE keyword', () => {
      expect(tokenize('true')[0].type).toBe(TokenType.TRUE)
    })

    it('tokenizes FALSE keyword', () => {
      expect(tokenize('false')[0].type).toBe(TokenType.FALSE)
    })

    it('tokenizes TRUE case-insensitively', () => {
      expect(tokenize('TRUE')[0].type).toBe(TokenType.TRUE)
      expect(tokenize('True')[0].type).toBe(TokenType.TRUE)
    })

    it('tokenizes FALSE case-insensitively', () => {
      expect(tokenize('FALSE')[0].type).toBe(TokenType.FALSE)
      expect(tokenize('False')[0].type).toBe(TokenType.FALSE)
    })
  })

  describe('keywords - cardinality modifiers', () => {
    it('tokenizes REQUIRED keyword', () => {
      expect(tokenize('required')[0].type).toBe(TokenType.REQUIRED)
    })

    it('tokenizes OPTIONAL keyword', () => {
      expect(tokenize('optional')[0].type).toBe(TokenType.OPTIONAL)
    })

    it('tokenizes MULTI keyword', () => {
      expect(tokenize('multi')[0].type).toBe(TokenType.MULTI)
    })

    it('tokenizes SINGLE keyword', () => {
      expect(tokenize('single')[0].type).toBe(TokenType.SINGLE)
    })
  })

  describe('keywords - schema definition', () => {
    it('tokenizes ABSTRACT keyword', () => {
      expect(tokenize('abstract')[0].type).toBe(TokenType.ABSTRACT)
    })

    it('tokenizes TYPE keyword', () => {
      expect(tokenize('type')[0].type).toBe(TokenType.TYPE)
    })

    it('tokenizes SCALAR keyword', () => {
      expect(tokenize('scalar')[0].type).toBe(TokenType.SCALAR)
    })

    it('tokenizes ENUM keyword', () => {
      expect(tokenize('enum')[0].type).toBe(TokenType.ENUM)
    })

    it('tokenizes CONSTRAINT keyword', () => {
      expect(tokenize('constraint')[0].type).toBe(TokenType.CONSTRAINT)
    })

    it('tokenizes INDEX keyword', () => {
      expect(tokenize('index')[0].type).toBe(TokenType.INDEX)
    })

    it('tokenizes ANNOTATION keyword', () => {
      expect(tokenize('annotation')[0].type).toBe(TokenType.ANNOTATION)
    })

    it('tokenizes MODULE keyword', () => {
      expect(tokenize('module')[0].type).toBe(TokenType.MODULE)
    })

    it('tokenizes ALIAS keyword', () => {
      expect(tokenize('alias')[0].type).toBe(TokenType.ALIAS)
    })

    it('tokenizes FUNCTION keyword', () => {
      expect(tokenize('function')[0].type).toBe(TokenType.FUNCTION)
    })

    it('tokenizes PROPERTY keyword', () => {
      expect(tokenize('property')[0].type).toBe(TokenType.PROPERTY)
    })

    it('tokenizes LINK keyword', () => {
      expect(tokenize('link')[0].type).toBe(TokenType.LINK)
    })

    it('tokenizes EXTENDING keyword', () => {
      expect(tokenize('extending')[0].type).toBe(TokenType.EXTENDING)
    })
  })

  describe('keywords - all keywords table', () => {
    const keywords: [string, TokenType][] = [
      ['select', TokenType.SELECT],
      ['insert', TokenType.INSERT],
      ['update', TokenType.UPDATE],
      ['delete', TokenType.DELETE],
      ['filter', TokenType.FILTER],
      ['order', TokenType.ORDER],
      ['by', TokenType.BY],
      ['limit', TokenType.LIMIT],
      ['offset', TokenType.OFFSET],
      ['with', TokenType.WITH],
      ['for', TokenType.FOR],
      ['if', TokenType.IF],
      ['else', TokenType.ELSE],
      ['and', TokenType.AND],
      ['or', TokenType.OR],
      ['not', TokenType.NOT],
      ['in', TokenType.IN],
      ['like', TokenType.LIKE],
      ['ilike', TokenType.ILIKE],
      ['is', TokenType.IS],
      ['exists', TokenType.EXISTS],
      ['distinct', TokenType.DISTINCT],
      ['union', TokenType.UNION],
      ['intersect', TokenType.INTERSECT],
      ['except', TokenType.EXCEPT],
      ['true', TokenType.TRUE],
      ['false', TokenType.FALSE],
      ['required', TokenType.REQUIRED],
      ['optional', TokenType.OPTIONAL],
      ['multi', TokenType.MULTI],
      ['single', TokenType.SINGLE],
      ['abstract', TokenType.ABSTRACT],
      ['type', TokenType.TYPE],
      ['scalar', TokenType.SCALAR],
      ['enum', TokenType.ENUM],
      ['constraint', TokenType.CONSTRAINT],
      ['index', TokenType.INDEX],
      ['annotation', TokenType.ANNOTATION],
      ['module', TokenType.MODULE],
      ['alias', TokenType.ALIAS],
      ['function', TokenType.FUNCTION],
      ['property', TokenType.PROPERTY],
      ['link', TokenType.LINK],
      ['extending', TokenType.EXTENDING],
    ]

    it.each(keywords)('tokenizes %s as %s', (input, expectedType) => {
      expect(tokenize(input)[0].type).toBe(expectedType)
    })

    it('has 44 keywords defined', () => {
      expect(keywords.length).toBe(44)
    })
  })

  // ============================================================================
  // OPERATOR TESTS
  // ============================================================================

  describe('operators - assignment and arrow', () => {
    it('tokenizes := (assignment)', () => {
      const tokens = tokenize(':=')
      expect(tokens[0].type).toBe(TokenType.ASSIGN)
      expect(tokens[0].value).toBe(':=')
    })

    it('tokenizes -> (arrow)', () => {
      const tokens = tokenize('->')
      expect(tokens[0].type).toBe(TokenType.ARROW)
      expect(tokens[0].value).toBe('->')
    })
  })

  describe('operators - path navigation', () => {
    it('tokenizes . (dot)', () => {
      const tokens = tokenize('.')
      expect(tokens[0].type).toBe(TokenType.DOT)
    })

    it('tokenizes .> (forward link)', () => {
      const tokens = tokenize('.>')
      expect(tokens[0].type).toBe(TokenType.FORWARD_LINK)
      expect(tokens[0].value).toBe('.>')
    })

    it('tokenizes .< (backward link)', () => {
      const tokens = tokenize('.<')
      expect(tokens[0].type).toBe(TokenType.BACKWARD_LINK)
      expect(tokens[0].value).toBe('.<')
    })
  })

  describe('operators - namespace and null coalescing', () => {
    it('tokenizes :: (namespace)', () => {
      const tokens = tokenize('::')
      expect(tokens[0].type).toBe(TokenType.NAMESPACE)
      expect(tokens[0].value).toBe('::')
    })

    it('tokenizes ?? (null coalesce)', () => {
      const tokens = tokenize('??')
      expect(tokens[0].type).toBe(TokenType.COALESCE)
      expect(tokens[0].value).toBe('??')
    })

    it('tokenizes ++ (concat)', () => {
      const tokens = tokenize('++')
      expect(tokens[0].type).toBe(TokenType.CONCAT)
      expect(tokens[0].value).toBe('++')
    })
  })

  describe('operators - comparison', () => {
    it('tokenizes = (equals)', () => {
      expect(tokenize('=')[0].type).toBe(TokenType.EQUALS)
    })

    it('tokenizes != (not equals)', () => {
      const tokens = tokenize('!=')
      expect(tokens[0].type).toBe(TokenType.NOT_EQUALS)
      expect(tokens[0].value).toBe('!=')
    })

    it('tokenizes < (less than)', () => {
      expect(tokenize('<')[0].type).toBe(TokenType.LESS_THAN)
    })

    it('tokenizes > (greater than)', () => {
      expect(tokenize('>')[0].type).toBe(TokenType.GREATER_THAN)
    })

    it('tokenizes <= (less or equal)', () => {
      const tokens = tokenize('<=')
      expect(tokens[0].type).toBe(TokenType.LESS_EQUAL)
      expect(tokens[0].value).toBe('<=')
    })

    it('tokenizes >= (greater or equal)', () => {
      const tokens = tokenize('>=')
      expect(tokens[0].type).toBe(TokenType.GREATER_EQUAL)
      expect(tokens[0].value).toBe('>=')
    })
  })

  describe('operators - arithmetic', () => {
    it('tokenizes + (plus)', () => {
      expect(tokenize('+')[0].type).toBe(TokenType.PLUS)
    })

    it('tokenizes - (minus)', () => {
      expect(tokenize('-')[0].type).toBe(TokenType.MINUS)
    })

    it('tokenizes * (multiply)', () => {
      expect(tokenize('*')[0].type).toBe(TokenType.MULTIPLY)
    })

    it('tokenizes / (divide)', () => {
      expect(tokenize('/')[0].type).toBe(TokenType.DIVIDE)
    })

    it('tokenizes % (modulo)', () => {
      expect(tokenize('%')[0].type).toBe(TokenType.MODULO)
    })

    it('tokenizes ^ (power)', () => {
      expect(tokenize('^')[0].type).toBe(TokenType.POWER)
    })
  })

  describe('operators - annotation/splat', () => {
    it('tokenizes @ (at)', () => {
      expect(tokenize('@')[0].type).toBe(TokenType.AT)
    })
  })

  describe('operators - all operators table', () => {
    const operators: [string, TokenType][] = [
      [':=', TokenType.ASSIGN],
      ['->', TokenType.ARROW],
      ['.', TokenType.DOT],
      ['.>', TokenType.FORWARD_LINK],
      ['.<', TokenType.BACKWARD_LINK],
      ['::', TokenType.NAMESPACE],
      ['??', TokenType.COALESCE],
      ['++', TokenType.CONCAT],
      ['=', TokenType.EQUALS],
      ['!=', TokenType.NOT_EQUALS],
      ['<', TokenType.LESS_THAN],
      ['>', TokenType.GREATER_THAN],
      ['<=', TokenType.LESS_EQUAL],
      ['>=', TokenType.GREATER_EQUAL],
      ['+', TokenType.PLUS],
      ['-', TokenType.MINUS],
      ['*', TokenType.MULTIPLY],
      ['/', TokenType.DIVIDE],
      ['%', TokenType.MODULO],
      ['^', TokenType.POWER],
      ['@', TokenType.AT],
    ]

    it.each(operators)('tokenizes %s as %s', (input, expectedType) => {
      expect(tokenize(input)[0].type).toBe(expectedType)
    })

    it('has 21 operators defined', () => {
      expect(operators.length).toBe(21)
    })
  })

  describe('operators - disambiguation', () => {
    it('distinguishes : from :=', () => {
      const tokens = tokenize(': :=')
      expect(tokens[0].type).toBe(TokenType.COLON)
      expect(tokens[1].type).toBe(TokenType.ASSIGN)
    })

    it('distinguishes . from .> and .<', () => {
      const tokens = tokenize('. .> .<')
      expect(tokens[0].type).toBe(TokenType.DOT)
      expect(tokens[1].type).toBe(TokenType.FORWARD_LINK)
      expect(tokens[2].type).toBe(TokenType.BACKWARD_LINK)
    })

    it('distinguishes + from ++', () => {
      const tokens = tokenize('+ ++')
      expect(tokens[0].type).toBe(TokenType.PLUS)
      expect(tokens[1].type).toBe(TokenType.CONCAT)
    })

    it('distinguishes < from <= and .<', () => {
      const tokens = tokenize('< <= .<')
      expect(tokens[0].type).toBe(TokenType.LESS_THAN)
      expect(tokens[1].type).toBe(TokenType.LESS_EQUAL)
      expect(tokens[2].type).toBe(TokenType.BACKWARD_LINK)
    })

    it('distinguishes - from ->', () => {
      const tokens = tokenize('- ->')
      expect(tokens[0].type).toBe(TokenType.MINUS)
      expect(tokens[1].type).toBe(TokenType.ARROW)
    })
  })

  // ============================================================================
  // DELIMITER TESTS
  // ============================================================================

  describe('delimiters', () => {
    it('tokenizes { (left brace)', () => {
      expect(tokenize('{')[0].type).toBe(TokenType.LBRACE)
    })

    it('tokenizes } (right brace)', () => {
      expect(tokenize('}')[0].type).toBe(TokenType.RBRACE)
    })

    it('tokenizes ( (left paren)', () => {
      expect(tokenize('(')[0].type).toBe(TokenType.LPAREN)
    })

    it('tokenizes ) (right paren)', () => {
      expect(tokenize(')')[0].type).toBe(TokenType.RPAREN)
    })

    it('tokenizes [ (left bracket)', () => {
      expect(tokenize('[')[0].type).toBe(TokenType.LBRACKET)
    })

    it('tokenizes ] (right bracket)', () => {
      expect(tokenize(']')[0].type).toBe(TokenType.RBRACKET)
    })

    it('tokenizes , (comma)', () => {
      expect(tokenize(',')[0].type).toBe(TokenType.COMMA)
    })

    it('tokenizes ; (semicolon)', () => {
      expect(tokenize(';')[0].type).toBe(TokenType.SEMICOLON)
    })

    it('tokenizes : (colon)', () => {
      expect(tokenize(':')[0].type).toBe(TokenType.COLON)
    })
  })

  describe('delimiters - all table', () => {
    const delimiters: [string, TokenType][] = [
      ['{', TokenType.LBRACE],
      ['}', TokenType.RBRACE],
      ['(', TokenType.LPAREN],
      [')', TokenType.RPAREN],
      ['[', TokenType.LBRACKET],
      [']', TokenType.RBRACKET],
      [',', TokenType.COMMA],
      [';', TokenType.SEMICOLON],
      [':', TokenType.COLON],
    ]

    it.each(delimiters)('tokenizes %s as %s', (input, expectedType) => {
      expect(tokenize(input)[0].type).toBe(expectedType)
    })

    it('has 9 delimiters defined', () => {
      expect(delimiters.length).toBe(9)
    })
  })

  // ============================================================================
  // LITERAL TESTS - STRINGS
  // ============================================================================

  describe('literals - strings', () => {
    it('tokenizes single-quoted string', () => {
      const tokens = tokenize("'hello'")
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('hello')
    })

    it('tokenizes double-quoted string', () => {
      const tokens = tokenize('"hello"')
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('hello')
    })

    it('tokenizes empty string', () => {
      expect(tokenize("''")[0].value).toBe('')
      expect(tokenize('""')[0].value).toBe('')
    })

    it('tokenizes string with spaces', () => {
      const tokens = tokenize("'hello world'")
      expect(tokens[0].value).toBe('hello world')
    })

    it('tokenizes escaped single quote in single-quoted string', () => {
      const tokens = tokenize("'it\\'s fine'")
      expect(tokens[0].value).toBe("it's fine")
    })

    it('tokenizes escaped double quote in double-quoted string', () => {
      const tokens = tokenize('"say \\"hello\\""')
      expect(tokens[0].value).toBe('say "hello"')
    })

    it('tokenizes escaped backslash', () => {
      const tokens = tokenize("'path\\\\to\\\\file'")
      expect(tokens[0].value).toBe('path\\to\\file')
    })

    it('tokenizes escaped newline', () => {
      const tokens = tokenize("'line1\\nline2'")
      expect(tokens[0].value).toBe('line1\nline2')
    })

    it('tokenizes escaped tab', () => {
      const tokens = tokenize("'col1\\tcol2'")
      expect(tokens[0].value).toBe('col1\tcol2')
    })

    it('tokenizes escaped carriage return', () => {
      const tokens = tokenize("'text\\r\\n'")
      expect(tokens[0].value).toBe('text\r\n')
    })

    it('tokenizes unicode escape \\uXXXX', () => {
      const tokens = tokenize("'\\u0041\\u0042\\u0043'")
      expect(tokens[0].value).toBe('ABC')
    })

    it('tokenizes unicode escape \\UXXXXXXXX', () => {
      const tokens = tokenize("'\\U0001F600'")
      expect(tokens[0].value).toBe('\u{1F600}') // Grinning face emoji
    })

    it('throws on unterminated string', () => {
      expect(() => tokenize("'hello")).toThrow()
      expect(() => tokenize('"hello')).toThrow()
    })

    it('tokenizes string containing single quote when double-quoted', () => {
      const tokens = tokenize('"it\'s fine"')
      expect(tokens[0].value).toBe("it's fine")
    })

    it('tokenizes string containing double quote when single-quoted', () => {
      const tokens = tokenize("'say \"hello\"'")
      expect(tokens[0].value).toBe('say "hello"')
    })
  })

  describe('literals - raw strings', () => {
    it('tokenizes raw single-quoted string (r\'...\')', () => {
      const tokens = tokenize("r'hello\\nworld'")
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('hello\\nworld') // Backslash-n literal, not newline
    })

    it('tokenizes raw double-quoted string (r"...")', () => {
      const tokens = tokenize('r"path\\to\\file"')
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('path\\to\\file')
    })
  })

  describe('literals - multiline strings', () => {
    it('tokenizes triple single-quoted multiline string', () => {
      const tokens = tokenize("'''line1\nline2\nline3'''")
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('line1\nline2\nline3')
    })

    it('tokenizes triple double-quoted multiline string', () => {
      const tokens = tokenize('"""line1\nline2"""')
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('line1\nline2')
    })

    it('allows single quotes inside triple single-quoted string', () => {
      const tokens = tokenize("'''it's a \"test\"'''")
      expect(tokens[0].value).toBe('it\'s a "test"')
    })

    it('allows double quotes inside triple double-quoted string', () => {
      const tokens = tokenize('"""say "hello" here"""')
      expect(tokens[0].value).toBe('say "hello" here')
    })
  })

  describe('literals - unicode strings', () => {
    it('tokenizes string with unicode characters', () => {
      const tokens = tokenize("'cafe'")
      expect(tokens[0].value).toBe('cafe')
    })

    it('tokenizes string with emoji', () => {
      const tokens = tokenize("'hello '")
      expect(tokens[0].value).toBe('hello ')
    })

    it('tokenizes string with Japanese characters', () => {
      const tokens = tokenize("''")
      expect(tokens[0].value).toBe('')
    })

    it('tokenizes string with mixed unicode', () => {
      const tokens = tokenize("'Hello  Bonjour  Hola'")
      expect(tokens[0].value).toBe('Hello  Bonjour  Hola')
    })

    it('tokenizes string with combining characters', () => {
      const tokens = tokenize("'cafe\u0301'") // e + combining acute accent
      expect(tokens[0].value).toBe('cafe\u0301')
    })

    it('tokenizes string with zero-width characters', () => {
      const tokens = tokenize("'a\u200Bb'") // a + zero-width space + b
      expect(tokens[0].value).toBe('a\u200Bb')
    })
  })

  // ============================================================================
  // LITERAL TESTS - NUMBERS
  // ============================================================================

  describe('literals - integers', () => {
    it('tokenizes zero', () => {
      const tokens = tokenize('0')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('0')
    })

    it('tokenizes positive integer', () => {
      const tokens = tokenize('123')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('123')
    })

    it('tokenizes large integer', () => {
      const tokens = tokenize('9999999999999')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('9999999999999')
    })

    it('tokenizes integer with underscores', () => {
      const tokens = tokenize('1_000_000')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('1_000_000')
    })
  })

  describe('literals - decimals', () => {
    it('tokenizes decimal with leading digit', () => {
      const tokens = tokenize('1.5')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('1.5')
    })

    it('tokenizes decimal with leading zero', () => {
      const tokens = tokenize('0.123')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('0.123')
    })

    it('tokenizes decimal without leading zero', () => {
      const tokens = tokenize('.5')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('.5')
    })

    it('tokenizes decimal with trailing zeros', () => {
      const tokens = tokenize('1.500')
      expect(tokens[0].value).toBe('1.500')
    })

    it('tokenizes decimal with underscores', () => {
      const tokens = tokenize('1_234.567_89')
      expect(tokens[0].value).toBe('1_234.567_89')
    })
  })

  describe('literals - scientific notation', () => {
    it('tokenizes positive exponent with e', () => {
      const tokens = tokenize('1e10')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('1e10')
    })

    it('tokenizes positive exponent with E', () => {
      const tokens = tokenize('1E10')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('1E10')
    })

    it('tokenizes explicit positive exponent', () => {
      const tokens = tokenize('1e+10')
      expect(tokens[0].value).toBe('1e+10')
    })

    it('tokenizes negative exponent', () => {
      const tokens = tokenize('1e-10')
      expect(tokens[0].value).toBe('1e-10')
    })

    it('tokenizes decimal with exponent', () => {
      const tokens = tokenize('1.5e10')
      expect(tokens[0].value).toBe('1.5e10')
    })

    it('tokenizes scientific notation with underscores', () => {
      const tokens = tokenize('1_000e1_0')
      expect(tokens[0].value).toBe('1_000e1_0')
    })
  })

  describe('literals - bigint suffix', () => {
    it('tokenizes integer with n suffix', () => {
      const tokens = tokenize('123n')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('123n')
    })

    it('tokenizes large bigint', () => {
      const tokens = tokenize('999999999999999999999n')
      expect(tokens[0].value).toBe('999999999999999999999n')
    })
  })

  describe('literals - hexadecimal', () => {
    it('tokenizes hex with lowercase prefix', () => {
      const tokens = tokenize('0x1a2b')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('0x1a2b')
    })

    it('tokenizes hex with uppercase prefix', () => {
      const tokens = tokenize('0X1A2B')
      expect(tokens[0].value).toBe('0X1A2B')
    })

    it('tokenizes hex with mixed case digits', () => {
      const tokens = tokenize('0xDeAdBeEf')
      expect(tokens[0].value).toBe('0xDeAdBeEf')
    })
  })

  describe('literals - octal', () => {
    it('tokenizes octal with 0o prefix', () => {
      const tokens = tokenize('0o755')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('0o755')
    })

    it('tokenizes octal with 0O prefix', () => {
      const tokens = tokenize('0O644')
      expect(tokens[0].value).toBe('0O644')
    })
  })

  describe('literals - binary', () => {
    it('tokenizes binary with 0b prefix', () => {
      const tokens = tokenize('0b1010')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('0b1010')
    })

    it('tokenizes binary with 0B prefix', () => {
      const tokens = tokenize('0B1111')
      expect(tokens[0].value).toBe('0B1111')
    })
  })

  // ============================================================================
  // LITERAL TESTS - UUID
  // ============================================================================

  describe('literals - uuid', () => {
    it('tokenizes lowercase UUID', () => {
      const tokens = tokenize('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      expect(tokens[0].type).toBe(TokenType.UUID)
      expect(tokens[0].value).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    })

    it('tokenizes uppercase UUID', () => {
      const tokens = tokenize('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11')
      expect(tokens[0].type).toBe(TokenType.UUID)
    })

    it('tokenizes mixed-case UUID', () => {
      const tokens = tokenize('a0EEbc99-9c0B-4ef8-BB6d-6bb9BD380a11')
      expect(tokens[0].type).toBe(TokenType.UUID)
    })

    it('does not tokenize invalid UUID format', () => {
      // Too short
      const tokens = tokenize('a0eebc99-9c0b-4ef8-bb6d')
      expect(tokens[0].type).not.toBe(TokenType.UUID)
    })
  })

  // ============================================================================
  // IDENTIFIER TESTS
  // ============================================================================

  describe('identifiers', () => {
    it('tokenizes simple identifier', () => {
      const tokens = tokenize('User')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('User')
    })

    it('tokenizes lowercase identifier', () => {
      const tokens = tokenize('name')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('name')
    })

    it('tokenizes identifier with underscore', () => {
      const tokens = tokenize('my_variable')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('my_variable')
    })

    it('tokenizes identifier starting with underscore', () => {
      const tokens = tokenize('_private')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('_private')
    })

    it('tokenizes identifier with double underscore prefix', () => {
      const tokens = tokenize('__type__')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('__type__')
    })

    it('tokenizes identifier with digits', () => {
      const tokens = tokenize('user123')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('user123')
    })

    it('does not tokenize identifier starting with digit', () => {
      const tokens = tokenize('123abc')
      expect(tokens[0].type).not.toBe(TokenType.IDENTIFIER)
      expect(tokens[0].type).toBe(TokenType.NUMBER)
    })

    it('tokenizes CamelCase identifier', () => {
      const tokens = tokenize('MyUserType')
      expect(tokens[0].value).toBe('MyUserType')
    })

    it('tokenizes snake_case identifier', () => {
      const tokens = tokenize('my_user_type')
      expect(tokens[0].value).toBe('my_user_type')
    })

    it('distinguishes identifier from keyword', () => {
      // 'selector' contains 'select' but is an identifier
      const tokens = tokenize('selector')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('selector')
    })
  })

  describe('identifiers - quoted', () => {
    it('tokenizes backtick-quoted identifier', () => {
      const tokens = tokenize('`select`')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('select')
    })

    it('tokenizes quoted identifier with spaces', () => {
      const tokens = tokenize('`my field`')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('my field')
    })

    it('tokenizes quoted identifier with special chars', () => {
      const tokens = tokenize('`field-name`')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('field-name')
    })

    it('allows reserved word as quoted identifier', () => {
      const tokens = tokenize('`true`')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe('true')
    })
  })

  // ============================================================================
  // PARAMETER TESTS
  // ============================================================================

  describe('parameters', () => {
    it('tokenizes named parameter', () => {
      const tokens = tokenize('$name')
      expect(tokens[0].type).toBe(TokenType.PARAMETER)
      expect(tokens[0].value).toBe('$name')
    })

    it('tokenizes positional parameter', () => {
      const tokens = tokenize('$1')
      expect(tokens[0].type).toBe(TokenType.PARAMETER)
      expect(tokens[0].value).toBe('$1')
    })

    it('tokenizes parameter with underscore', () => {
      const tokens = tokenize('$user_id')
      expect(tokens[0].type).toBe(TokenType.PARAMETER)
      expect(tokens[0].value).toBe('$user_id')
    })

    it('tokenizes multiple positional parameters', () => {
      const tokens = tokenize('$1 $2 $3')
      expect(tokens[0].value).toBe('$1')
      expect(tokens[1].value).toBe('$2')
      expect(tokens[2].value).toBe('$3')
    })

    it('tokenizes parameter at zero', () => {
      const tokens = tokenize('$0')
      expect(tokens[0].type).toBe(TokenType.PARAMETER)
      expect(tokens[0].value).toBe('$0')
    })
  })

  // ============================================================================
  // COMMENT TESTS
  // ============================================================================

  describe('comments', () => {
    it('skips single-line comment with #', () => {
      const tokens = tokenize('select # this is a comment\nUser')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[1].value).toBe('User')
    })

    it('handles comment at end of input', () => {
      const tokens = tokenize('select # comment')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.EOF)
    })

    it('handles empty comment', () => {
      const tokens = tokenize('select #\nUser')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('preserves comment token when requested', () => {
      // Some lexers have option to preserve comments for tooling
      // This tests that capability if available
      const tokens = tokenize('select # comment', { preserveComments: true })
      const comment = tokens.find((t) => t.type === TokenType.COMMENT)
      expect(comment).toBeDefined()
      expect(comment?.value).toBe('# comment')
    })
  })

  // ============================================================================
  // WHITESPACE TESTS
  // ============================================================================

  describe('whitespace', () => {
    it('skips spaces', () => {
      const tokens = tokenize('select   User')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('skips tabs', () => {
      const tokens = tokenize('select\t\tUser')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('skips newlines', () => {
      const tokens = tokenize('select\n\nUser')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('skips carriage returns', () => {
      const tokens = tokenize('select\r\nUser')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('handles mixed whitespace', () => {
      const tokens = tokenize('select \t\n\r\n  User')
      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })
  })

  // ============================================================================
  // POSITION TRACKING TESTS
  // ============================================================================

  describe('position tracking', () => {
    it('tracks position (character offset)', () => {
      const tokens = tokenize('select User')
      expect(tokens[0].position).toBe(0)
      expect(tokens[1].position).toBe(7) // 'select ' = 7 chars
    })

    it('tracks line number starting at 1', () => {
      const tokens = tokenize('select\nUser\nname')
      expect(tokens[0].line).toBe(1) // select
      expect(tokens[1].line).toBe(2) // User
      expect(tokens[2].line).toBe(3) // name
    })

    it('tracks column number starting at 1', () => {
      const tokens = tokenize('select User')
      expect(tokens[0].column).toBe(1)
      expect(tokens[1].column).toBe(8) // 'select ' = 7, so User starts at 8
    })

    it('resets column on newline', () => {
      const tokens = tokenize('select\nUser')
      expect(tokens[0].column).toBe(1)
      expect(tokens[1].column).toBe(1) // Reset after newline
    })

    it('tracks position through whitespace', () => {
      const tokens = tokenize('   select')
      expect(tokens[0].position).toBe(3)
      expect(tokens[0].column).toBe(4)
    })

    it('tracks position for multi-character tokens', () => {
      const tokens = tokenize(':= ->')
      expect(tokens[0].position).toBe(0)
      expect(tokens[0].column).toBe(1)
      expect(tokens[1].position).toBe(3)
      expect(tokens[1].column).toBe(4)
    })

    it('tracks position in multiline input', () => {
      const tokens = tokenize('select\n  User { name }')
      const userToken = tokens.find((t) => t.value === 'User')
      expect(userToken?.line).toBe(2)
      expect(userToken?.column).toBe(3) // 2 spaces + User
    })

    it('tracks position for string literals', () => {
      const tokens = tokenize("name := 'hello'")
      const stringToken = tokens.find((t) => t.type === TokenType.STRING)
      expect(stringToken?.position).toBe(8) // 'name := ' = 8 chars
    })

    it('tracks position through multiline strings', () => {
      const tokens = tokenize("'''line1\nline2'''\nnext")
      const nextToken = tokens.find((t) => t.value === 'next')
      expect(nextToken?.line).toBe(3)
      expect(nextToken?.column).toBe(1)
    })
  })

  describe('position tracking - edge cases', () => {
    it('handles Windows line endings (CRLF)', () => {
      const tokens = tokenize('select\r\nUser\r\nname')
      expect(tokens[0].line).toBe(1)
      expect(tokens[1].line).toBe(2)
      expect(tokens[2].line).toBe(3)
    })

    it('handles old Mac line endings (CR only)', () => {
      const tokens = tokenize('select\rUser')
      expect(tokens[0].line).toBe(1)
      expect(tokens[1].line).toBe(2)
    })

    it('tracks EOF position', () => {
      const tokens = tokenize('select')
      const eof = tokens.find((t) => t.type === TokenType.EOF)
      expect(eof?.position).toBe(6)
      expect(eof?.column).toBe(7)
    })

    it('handles empty input', () => {
      const tokens = tokenize('')
      expect(tokens.length).toBe(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
      expect(tokens[0].position).toBe(0)
      expect(tokens[0].line).toBe(1)
      expect(tokens[0].column).toBe(1)
    })

    it('handles only whitespace', () => {
      const tokens = tokenize('   \n\n  ')
      expect(tokens.length).toBe(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })
  })

  // ============================================================================
  // EOF TESTS
  // ============================================================================

  describe('EOF handling', () => {
    it('always ends with EOF token', () => {
      const tokens = tokenize('select User')
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF)
    })

    it('EOF has empty value', () => {
      const tokens = tokenize('select')
      const eof = tokens[tokens.length - 1]
      expect(eof.value).toBe('')
    })

    it('returns only EOF for empty input', () => {
      const tokens = tokenize('')
      expect(tokens.length).toBe(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('error handling', () => {
    it('throws on unexpected character', () => {
      expect(() => tokenize('~invalid')).toThrow()
    })

    it('includes line number in error', () => {
      try {
        tokenize('select\n~')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toContain('line 2')
      }
    })

    it('includes column number in error', () => {
      try {
        tokenize('select ~')
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toContain('column 8')
      }
    })

    it('throws on unterminated string', () => {
      expect(() => tokenize("'unterminated")).toThrow()
    })

    it('includes position info in unterminated string error', () => {
      try {
        tokenize("name := 'value")
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toContain('unterminated')
      }
    })

    it('throws on invalid escape sequence', () => {
      expect(() => tokenize("'\\z'")).toThrow()
    })

    it('throws on invalid unicode escape', () => {
      expect(() => tokenize("'\\uXXXX'")).toThrow()
    })
  })

  // ============================================================================
  // INTEGRATION TESTS - REALISTIC QUERIES
  // ============================================================================

  describe('integration - realistic queries', () => {
    it('tokenizes simple select', () => {
      const tokens = tokenize('select User { name }')
      expect(tokenTypes(tokens.slice(0, -1).join(','))).toBeDefined()
      expect(tokens.map((t) => t.type)).toEqual([
        TokenType.SELECT,
        TokenType.IDENTIFIER,
        TokenType.LBRACE,
        TokenType.IDENTIFIER,
        TokenType.RBRACE,
        TokenType.EOF,
      ])
    })

    it('tokenizes select with filter', () => {
      const tokens = tokenize('select User { name } filter .active = true')
      expect(tokens.map((t) => t.type)).toEqual([
        TokenType.SELECT,
        TokenType.IDENTIFIER,
        TokenType.LBRACE,
        TokenType.IDENTIFIER,
        TokenType.RBRACE,
        TokenType.FILTER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.TRUE,
        TokenType.EOF,
      ])
    })

    it('tokenizes insert with assignment', () => {
      const tokens = tokenize("insert User { name := 'Alice', age := 30 }")
      expect(tokens.map((t) => t.type)).toEqual([
        TokenType.INSERT,
        TokenType.IDENTIFIER,
        TokenType.LBRACE,
        TokenType.IDENTIFIER,
        TokenType.ASSIGN,
        TokenType.STRING,
        TokenType.COMMA,
        TokenType.IDENTIFIER,
        TokenType.ASSIGN,
        TokenType.NUMBER,
        TokenType.RBRACE,
        TokenType.EOF,
      ])
    })

    it('tokenizes update with nested shape', () => {
      const tokens = tokenize('update User filter .id = $id set { active := true }')
      expect(tokens.map((t) => t.type)).toContain(TokenType.UPDATE)
      expect(tokens.map((t) => t.type)).toContain(TokenType.FILTER)
      expect(tokens.map((t) => t.type)).toContain(TokenType.PARAMETER)
    })

    it('tokenizes delete with filter', () => {
      const tokens = tokenize('delete User filter .id = $1')
      expect(tokens[0].type).toBe(TokenType.DELETE)
    })

    it('tokenizes select with order by and limit', () => {
      const tokens = tokenize('select User { name } order by .created_at limit 10')
      expect(tokens.map((t) => t.type)).toContain(TokenType.ORDER)
      expect(tokens.map((t) => t.type)).toContain(TokenType.BY)
      expect(tokens.map((t) => t.type)).toContain(TokenType.LIMIT)
    })

    it('tokenizes nested shape', () => {
      const tokens = tokenize('select User { name, posts: { title, content } }')
      // Should have nested braces
      const braceCount = tokens.filter((t) => t.type === TokenType.LBRACE).length
      expect(braceCount).toBe(2)
    })

    it('tokenizes with clause', () => {
      const tokens = tokenize('with x := select User select x { name }')
      expect(tokens[0].type).toBe(TokenType.WITH)
    })

    it('tokenizes type definition', () => {
      const tokens = tokenize('type User extending Object { required property name -> str }')
      expect(tokens.map((t) => t.type)).toContain(TokenType.TYPE)
      expect(tokens.map((t) => t.type)).toContain(TokenType.EXTENDING)
      expect(tokens.map((t) => t.type)).toContain(TokenType.REQUIRED)
      expect(tokens.map((t) => t.type)).toContain(TokenType.PROPERTY)
      expect(tokens.map((t) => t.type)).toContain(TokenType.ARROW)
    })

    it('tokenizes module declaration', () => {
      const tokens = tokenize('module myapp { }')
      expect(tokens[0].type).toBe(TokenType.MODULE)
    })

    it('tokenizes complex filter expression', () => {
      const tokens = tokenize("select User filter .age >= 18 and .active = true and .name like '%test%'")
      expect(tokens.map((t) => t.type)).toContain(TokenType.GREATER_EQUAL)
      expect(tokens.map((t) => t.type)).toContain(TokenType.AND)
      expect(tokens.map((t) => t.type)).toContain(TokenType.LIKE)
    })

    it('tokenizes path navigation', () => {
      const tokens = tokenize('select User { author: { .<posts[is Blog] } }')
      expect(tokens.map((t) => t.type)).toContain(TokenType.BACKWARD_LINK)
      expect(tokens.map((t) => t.type)).toContain(TokenType.LBRACKET)
      expect(tokens.map((t) => t.type)).toContain(TokenType.IS)
    })

    it('tokenizes namespace qualified type', () => {
      const tokens = tokenize('select default::User')
      expect(tokens.map((t) => t.type)).toContain(TokenType.NAMESPACE)
    })

    it('tokenizes null coalescing', () => {
      const tokens = tokenize("select User { nickname ?? 'anonymous' }")
      expect(tokens.map((t) => t.type)).toContain(TokenType.COALESCE)
    })

    it('tokenizes string concatenation', () => {
      const tokens = tokenize("select .first_name ++ ' ' ++ .last_name")
      const concatCount = tokens.filter((t) => t.type === TokenType.CONCAT).length
      expect(concatCount).toBe(2)
    })

    it('tokenizes annotation access', () => {
      const tokens = tokenize('select User { @source_file }')
      expect(tokens.map((t) => t.type)).toContain(TokenType.AT)
    })
  })

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  describe('edge cases', () => {
    it('handles adjacent operators without space', () => {
      const tokens = tokenize(':=:=')
      expect(tokens[0].type).toBe(TokenType.ASSIGN)
      expect(tokens[1].type).toBe(TokenType.ASSIGN)
    })

    it('handles identifiers that look like keywords', () => {
      expect(tokenize('selector')[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokenize('updating')[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokenize('deleted')[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokenize('inserts')[0].type).toBe(TokenType.IDENTIFIER)
    })

    it('handles numeric-like identifiers', () => {
      // These should NOT be valid identifiers
      const tokens = tokenize('123abc')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
    })

    it('handles consecutive string literals', () => {
      const tokens = tokenize("'a' 'b'")
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('a')
      expect(tokens[1].type).toBe(TokenType.STRING)
      expect(tokens[1].value).toBe('b')
    })

    it('handles very long identifier', () => {
      const longName = 'a'.repeat(1000)
      const tokens = tokenize(longName)
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[0].value).toBe(longName)
    })

    it('handles very long string', () => {
      const longString = "'a" + 'b'.repeat(10000) + "'"
      const tokens = tokenize(longString)
      expect(tokens[0].type).toBe(TokenType.STRING)
    })

    it('handles deeply nested braces', () => {
      const input = 'select User { a: { b: { c: { d: { e: { } } } } } }'
      const tokens = tokenize(input)
      const lbraces = tokens.filter((t) => t.type === TokenType.LBRACE).length
      const rbraces = tokens.filter((t) => t.type === TokenType.RBRACE).length
      expect(lbraces).toBe(6)
      expect(rbraces).toBe(6)
    })

    it('handles maximal operator sequence', () => {
      // All operators adjacent
      const tokens = tokenize(':=->.<.>::??++=!=<><=>=+-*/%^@')
      expect(tokens.length).toBeGreaterThan(15)
    })

    it('handles empty braces', () => {
      const tokens = tokenize('{}')
      expect(tokens[0].type).toBe(TokenType.LBRACE)
      expect(tokens[1].type).toBe(TokenType.RBRACE)
    })

    it('handles only comments', () => {
      const tokens = tokenize('# just a comment')
      expect(tokens.length).toBe(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })

    it('handles unicode in identifiers (if supported)', () => {
      // EdgeQL may or may not support unicode identifiers
      // This test documents expected behavior
      const tokens = tokenize('cafe')
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER)
    })
  })

  // ============================================================================
  // PERFORMANCE SANITY TESTS
  // ============================================================================

  describe('performance sanity', () => {
    it('tokenizes 1000 tokens in reasonable time', () => {
      const input = 'select User { name } '.repeat(200) // ~1000 tokens
      const start = performance.now()
      const tokens = tokenize(input)
      const elapsed = performance.now() - start

      expect(tokens.length).toBeGreaterThan(900)
      expect(elapsed).toBeLessThan(100) // Should complete in < 100ms
    })

    it('handles input with many newlines', () => {
      const input = Array(1000)
        .fill('select User')
        .join('\n')
      const tokens = tokenize(input)
      expect(tokens.length).toBe(2001) // 1000 * 2 tokens + EOF
    })
  })
})
