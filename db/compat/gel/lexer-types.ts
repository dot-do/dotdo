/**
 * EdgeQL Lexer Types
 *
 * Type definitions for the EdgeQL lexer. This file contains minimal stubs
 * to allow TypeScript compilation while keeping tests in RED state.
 *
 * @see dotdo-jyxc6 - RED: EdgeQL Lexer - Token specification tests
 */

// ============================================================================
// TOKEN TYPES
// ============================================================================

/**
 * All EdgeQL token types
 *
 * Categories:
 * - Keywords: Language reserved words
 * - Operators: Mathematical, comparison, and assignment operators
 * - Delimiters: Brackets, braces, punctuation
 * - Literals: String, number, boolean, uuid values
 * - Identifiers: User-defined names
 * - Parameters: Query parameters ($name, $1)
 * - Special: EOF, comments, whitespace markers
 */
export enum TokenType {
  // -------------------------------------------------------------------------
  // Keywords - Statement types
  // -------------------------------------------------------------------------
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',

  // -------------------------------------------------------------------------
  // Keywords - Clauses
  // -------------------------------------------------------------------------
  FILTER = 'FILTER',
  ORDER = 'ORDER',
  BY = 'BY',
  LIMIT = 'LIMIT',
  OFFSET = 'OFFSET',
  WITH = 'WITH',
  FOR = 'FOR',

  // -------------------------------------------------------------------------
  // Keywords - Conditionals
  // -------------------------------------------------------------------------
  IF = 'IF',
  ELSE = 'ELSE',

  // -------------------------------------------------------------------------
  // Keywords - Logical operators
  // -------------------------------------------------------------------------
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IN = 'IN',
  LIKE = 'LIKE',
  ILIKE = 'ILIKE',
  IS = 'IS',
  EXISTS = 'EXISTS',

  // -------------------------------------------------------------------------
  // Keywords - Set operations
  // -------------------------------------------------------------------------
  DISTINCT = 'DISTINCT',
  UNION = 'UNION',
  INTERSECT = 'INTERSECT',
  EXCEPT = 'EXCEPT',

  // -------------------------------------------------------------------------
  // Keywords - Boolean literals
  // -------------------------------------------------------------------------
  TRUE = 'TRUE',
  FALSE = 'FALSE',

  // -------------------------------------------------------------------------
  // Keywords - Cardinality modifiers
  // -------------------------------------------------------------------------
  REQUIRED = 'REQUIRED',
  OPTIONAL = 'OPTIONAL',
  MULTI = 'MULTI',
  SINGLE = 'SINGLE',

  // -------------------------------------------------------------------------
  // Keywords - Schema definition
  // -------------------------------------------------------------------------
  ABSTRACT = 'ABSTRACT',
  TYPE = 'TYPE',
  SCALAR = 'SCALAR',
  ENUM = 'ENUM',
  CONSTRAINT = 'CONSTRAINT',
  INDEX = 'INDEX',
  ANNOTATION = 'ANNOTATION',
  MODULE = 'MODULE',
  ALIAS = 'ALIAS',
  FUNCTION = 'FUNCTION',
  PROPERTY = 'PROPERTY',
  LINK = 'LINK',
  EXTENDING = 'EXTENDING',

  // -------------------------------------------------------------------------
  // Operators - Assignment and arrow
  // -------------------------------------------------------------------------
  ASSIGN = 'ASSIGN', // :=
  ARROW = 'ARROW', // ->

  // -------------------------------------------------------------------------
  // Operators - Path navigation
  // -------------------------------------------------------------------------
  DOT = 'DOT', // .
  FORWARD_LINK = 'FORWARD_LINK', // .>
  BACKWARD_LINK = 'BACKWARD_LINK', // .<

  // -------------------------------------------------------------------------
  // Operators - Namespace and null coalescing
  // -------------------------------------------------------------------------
  NAMESPACE = 'NAMESPACE', // ::
  COALESCE = 'COALESCE', // ??
  CONCAT = 'CONCAT', // ++

  // -------------------------------------------------------------------------
  // Operators - Comparison
  // -------------------------------------------------------------------------
  EQUALS = 'EQUALS', // =
  NOT_EQUALS = 'NOT_EQUALS', // !=
  LESS_THAN = 'LESS_THAN', // <
  GREATER_THAN = 'GREATER_THAN', // >
  LESS_EQUAL = 'LESS_EQUAL', // <=
  GREATER_EQUAL = 'GREATER_EQUAL', // >=

  // -------------------------------------------------------------------------
  // Operators - Optional comparison
  // -------------------------------------------------------------------------
  QUESTION = 'QUESTION', // ?
  OPTIONAL_EQUALS = 'OPTIONAL_EQUALS', // ?=
  OPTIONAL_NOT_EQUALS = 'OPTIONAL_NOT_EQUALS', // ?!=

  // -------------------------------------------------------------------------
  // Operators - Arithmetic
  // -------------------------------------------------------------------------
  PLUS = 'PLUS', // +
  MINUS = 'MINUS', // -
  MULTIPLY = 'MULTIPLY', // *
  DIVIDE = 'DIVIDE', // /
  MODULO = 'MODULO', // %
  POWER = 'POWER', // ^
  PIPE = 'PIPE', // |

  // -------------------------------------------------------------------------
  // Operators - Annotation/Splat
  // -------------------------------------------------------------------------
  AT = 'AT', // @

  // -------------------------------------------------------------------------
  // Delimiters
  // -------------------------------------------------------------------------
  LBRACE = 'LBRACE', // {
  RBRACE = 'RBRACE', // }
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )
  LBRACKET = 'LBRACKET', // [
  RBRACKET = 'RBRACKET', // ]
  COMMA = 'COMMA', // ,
  SEMICOLON = 'SEMICOLON', // ;
  COLON = 'COLON', // :

  // -------------------------------------------------------------------------
  // Literals
  // -------------------------------------------------------------------------
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  UUID = 'UUID',

  // -------------------------------------------------------------------------
  // Identifiers and Parameters
  // -------------------------------------------------------------------------
  IDENTIFIER = 'IDENTIFIER',
  PARAMETER = 'PARAMETER', // $name or $1

  // -------------------------------------------------------------------------
  // Special
  // -------------------------------------------------------------------------
  EOF = 'EOF',
  COMMENT = 'COMMENT',
}

// ============================================================================
// TOKEN INTERFACE
// ============================================================================

/**
 * A single token from the lexer
 */
export interface Token {
  /** The type of token */
  type: TokenType

  /** The raw text value of the token */
  value: string

  /** Character offset in the source string (0-indexed) */
  position: number

  /** Line number (1-indexed) */
  line: number

  /** Column number (1-indexed) */
  column: number
}

// ============================================================================
// LEXER ERROR
// ============================================================================

/**
 * Error thrown when lexer encounters invalid input
 */
export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
    public readonly position: number
  ) {
    super(`${message} at line ${line}, column ${column}`)
    this.name = 'LexerError'
  }
}
