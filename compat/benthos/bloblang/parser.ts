/**
 * GREEN Phase Implementation: Bloblang Parser
 * Issue: dotdo-0hqfx
 *
 * Recursive descent parser for the Bloblang language.
 * Converts tokens from the Lexer into an Abstract Syntax Tree (AST).
 */

import { Lexer, Token, TokenType } from './lexer'
import {
  ASTNode,
  LiteralNode,
  IdentifierNode,
  RootNode,
  ThisNode,
  MetaNode,
  BinaryOpNode,
  UnaryOpNode,
  MemberAccessNode,
  CallNode,
  ArrayNode,
  ObjectNode,
  IfNode,
  MatchNode,
  LetNode,
  PipeNode,
  ArrowNode,
  AssignNode,
  BinaryOperator,
  UnaryOperator,
  LiteralKind
} from './ast'

export class ParseError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`)
    this.name = 'ParseError'
    this.line = line
    this.column = column
  }
}

/**
 * Operator precedence levels (higher = tighter binding)
 */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6
}

/**
 * Map token types to their operator strings
 */
const TOKEN_TO_OPERATOR: Record<string, BinaryOperator> = {
  [TokenType.PLUS]: '+',
  [TokenType.MINUS]: '-',
  [TokenType.STAR]: '*',
  [TokenType.SLASH]: '/',
  [TokenType.PERCENT]: '%',
  [TokenType.EQ]: '==',
  [TokenType.NEQ]: '!=',
  [TokenType.LT]: '<',
  [TokenType.GT]: '>',
  [TokenType.LTE]: '<=',
  [TokenType.GTE]: '>=',
  [TokenType.AND]: '&&',
  [TokenType.OR]: '||'
}

export class Parser {
  private lexer: Lexer
  private currentToken: Token

  constructor(lexer: Lexer) {
    this.lexer = lexer
    this.currentToken = this.lexer.next()
  }

  private peek(): Token {
    return this.currentToken
  }

  private peekNext(): Token {
    return this.lexer.lookahead(0)
  }

  private advance(): Token {
    const token = this.currentToken
    this.currentToken = this.lexer.next()
    return token
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        return true
      }
    }
    return false
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance()
    }
    const token = this.peek()
    throw new ParseError(message, token.line, token.column)
  }

  private error(message: string): never {
    const token = this.peek()
    throw new ParseError(message, token.line, token.column)
  }

  /**
   * Parse the source and return an AST node
   */
  parse(): ASTNode {
    // Handle empty input
    if (this.check(TokenType.EOF)) {
      return {
        type: 'Literal',
        kind: 'null',
        value: null,
        line: 1,
        column: 1
      } as LiteralNode
    }

    const ast = this.parseExpression()

    // Ensure we consumed all tokens (except EOF)
    if (!this.check(TokenType.EOF)) {
      // Could be additional expressions, which is OK for some cases
    }

    return ast
  }

  /**
   * Parse a complete expression (may include assignment)
   */
  private parseExpression(): ASTNode {
    return this.parseAssignment()
  }

  /**
   * Parse assignment: identifier = expression
   */
  private parseAssignment(): ASTNode {
    // Look ahead to check if this is an assignment
    // Assignment requires: IDENTIFIER = expression
    // But we need to distinguish from comparison ==
    if (this.check(TokenType.IDENTIFIER)) {
      const next = this.peekNext()
      if (next.type === TokenType.ASSIGN) {
        const idToken = this.advance() // consume identifier
        this.advance() // consume =
        const value = this.parsePipe()
        return {
          type: 'Assign',
          field: idToken.value,
          value,
          line: idToken.line,
          column: idToken.column
        } as AssignNode
      }
    }

    return this.parsePipe()
  }

  /**
   * Parse pipe expressions: expr | expr | ...
   */
  private parsePipe(): ASTNode {
    let left = this.parseArrow()

    while (this.match(TokenType.PIPE)) {
      const opToken = this.advance()
      const right = this.parseArrow()
      left = {
        type: 'Pipe',
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as PipeNode
    }

    return left
  }

  /**
   * Parse arrow/lambda functions: param -> body
   */
  private parseArrow(): ASTNode {
    // Check for arrow function: identifier ->
    if (this.check(TokenType.IDENTIFIER)) {
      const next = this.peekNext()
      if (next.type === TokenType.ARROW) {
        const paramToken = this.advance() // consume identifier
        this.advance() // consume ->
        const body = this.parseArrow() // right-associative
        return {
          type: 'Arrow',
          parameter: paramToken.value,
          body,
          line: paramToken.line,
          column: paramToken.column
        } as ArrowNode
      }
    }

    return this.parseOr()
  }

  /**
   * Parse OR expressions: expr || expr
   */
  private parseOr(): ASTNode {
    let left = this.parseAnd()

    while (this.match(TokenType.OR)) {
      const opToken = this.advance()
      const right = this.parseAnd()
      left = {
        type: 'BinaryOp',
        operator: '||',
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse AND expressions: expr && expr
   */
  private parseAnd(): ASTNode {
    let left = this.parseEquality()

    while (this.match(TokenType.AND)) {
      const opToken = this.advance()
      const right = this.parseEquality()
      left = {
        type: 'BinaryOp',
        operator: '&&',
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse equality: expr == expr, expr != expr
   */
  private parseEquality(): ASTNode {
    let left = this.parseComparison()

    while (this.match(TokenType.EQ, TokenType.NEQ)) {
      const opToken = this.advance()
      const operator = TOKEN_TO_OPERATOR[opToken.type]
      const right = this.parseComparison()
      left = {
        type: 'BinaryOp',
        operator,
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse comparison: expr < expr, expr > expr, expr <= expr, expr >= expr
   */
  private parseComparison(): ASTNode {
    let left = this.parseAdditive()

    while (this.match(TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE)) {
      const opToken = this.advance()
      const operator = TOKEN_TO_OPERATOR[opToken.type]
      const right = this.parseAdditive()
      left = {
        type: 'BinaryOp',
        operator,
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse additive: expr + expr, expr - expr
   */
  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative()

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const opToken = this.advance()
      const operator = TOKEN_TO_OPERATOR[opToken.type]
      const right = this.parseMultiplicative()
      left = {
        type: 'BinaryOp',
        operator,
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse multiplicative: expr * expr, expr / expr, expr % expr
   */
  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary()

    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const opToken = this.advance()
      const operator = TOKEN_TO_OPERATOR[opToken.type]
      const right = this.parseUnary()
      left = {
        type: 'BinaryOp',
        operator,
        left,
        right,
        line: opToken.line,
        column: opToken.column
      } as BinaryOpNode
    }

    return left
  }

  /**
   * Parse unary operators: -expr, !expr
   */
  private parseUnary(): ASTNode {
    if (this.match(TokenType.MINUS, TokenType.NOT)) {
      const opToken = this.advance()
      const operator = opToken.type === TokenType.MINUS ? '-' : '!'
      const operand = this.parseUnary() // right-associative for chaining
      return {
        type: 'UnaryOp',
        operator: operator as UnaryOperator,
        operand,
        line: opToken.line,
        column: opToken.column
      } as UnaryOpNode
    }

    return this.parsePostfix()
  }

  /**
   * Parse postfix expressions: member access, function calls
   */
  private parsePostfix(): ASTNode {
    let left = this.parsePrimary()

    while (true) {
      if (this.match(TokenType.DOT)) {
        const dotToken = this.advance()
        const propToken = this.consume(TokenType.IDENTIFIER, 'Expected property name after .')
        left = {
          type: 'MemberAccess',
          object: left,
          property: propToken.value,
          accessType: 'dot',
          line: dotToken.line,
          column: dotToken.column
        } as MemberAccessNode
      } else if (this.match(TokenType.OPTIONAL_CHAIN)) {
        const optToken = this.advance()
        const propToken = this.consume(TokenType.IDENTIFIER, 'Expected property name after ?.')
        left = {
          type: 'MemberAccess',
          object: left,
          property: propToken.value,
          accessType: 'optional',
          line: optToken.line,
          column: optToken.column
        } as MemberAccessNode
      } else if (this.match(TokenType.LBRACKET)) {
        const bracketToken = this.advance()
        const index = this.parseExpression()
        this.consume(TokenType.RBRACKET, 'Expected ] after bracket access')

        // If the index is a string literal, extract the string value
        let property: string | ASTNode = index
        if (index.type === 'Literal' && index.kind === 'string') {
          property = index.value as string
        }

        left = {
          type: 'MemberAccess',
          object: left,
          property,
          accessType: 'bracket',
          line: bracketToken.line,
          column: bracketToken.column
        } as MemberAccessNode
      } else if (this.match(TokenType.LPAREN)) {
        const parenToken = this.advance()
        const args = this.parseArgumentList()
        this.consume(TokenType.RPAREN, 'Expected ) after function arguments')
        left = {
          type: 'Call',
          function: left,
          arguments: args,
          line: parenToken.line,
          column: parenToken.column
        } as CallNode
      } else {
        break
      }
    }

    return left
  }

  /**
   * Parse function argument list
   */
  private parseArgumentList(): ASTNode[] {
    const args: ASTNode[] = []

    if (!this.check(TokenType.RPAREN)) {
      args.push(this.parsePipe()) // use parsePipe to allow arrows in args

      while (this.match(TokenType.COMMA)) {
        this.advance()
        args.push(this.parsePipe())
      }
    }

    return args
  }

  /**
   * Parse primary expressions: literals, identifiers, grouping, etc.
   */
  private parsePrimary(): ASTNode {
    const token = this.peek()

    // String literals
    if (this.match(TokenType.STRING)) {
      const t = this.advance()
      return {
        type: 'Literal',
        kind: 'string',
        value: t.value,
        line: t.line,
        column: t.column
      } as LiteralNode
    }

    // Number literals
    if (this.match(TokenType.NUMBER)) {
      const t = this.advance()
      return {
        type: 'Literal',
        kind: 'number',
        value: parseFloat(t.value),
        line: t.line,
        column: t.column
      } as LiteralNode
    }

    // Boolean literals
    if (this.match(TokenType.BOOLEAN)) {
      const t = this.advance()
      return {
        type: 'Literal',
        kind: 'boolean',
        value: t.value === 'true',
        line: t.line,
        column: t.column
      } as LiteralNode
    }

    // Null literal
    if (this.match(TokenType.NULL)) {
      const t = this.advance()
      return {
        type: 'Literal',
        kind: 'null',
        value: null,
        line: t.line,
        column: t.column
      } as LiteralNode
    }

    // Root reference
    if (this.match(TokenType.ROOT)) {
      const t = this.advance()
      return {
        type: 'Root',
        line: t.line,
        column: t.column
      } as RootNode
    }

    // This reference
    if (this.match(TokenType.THIS)) {
      const t = this.advance()
      return {
        type: 'This',
        line: t.line,
        column: t.column
      } as ThisNode
    }

    // Meta reference
    if (this.match(TokenType.META)) {
      const t = this.advance()
      return {
        type: 'Meta',
        line: t.line,
        column: t.column
      } as MetaNode
    }

    // Map keyword treated as identifier (for function calls like map(x -> x))
    if (this.check(TokenType.MAP)) {
      const t = this.advance()
      return {
        type: 'Identifier',
        name: t.value,
        line: t.line,
        column: t.column
      } as IdentifierNode
    }

    // If expression
    if (this.match(TokenType.IF)) {
      return this.parseIf()
    }

    // Match expression
    if (this.match(TokenType.MATCH)) {
      return this.parseMatch()
    }

    // Let binding
    if (this.match(TokenType.LET)) {
      return this.parseLet()
    }

    // Array literal
    if (this.match(TokenType.LBRACKET)) {
      return this.parseArray()
    }

    // Object literal
    if (this.match(TokenType.LBRACE)) {
      return this.parseObject()
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      this.advance()
      const expr = this.parseExpression()
      this.consume(TokenType.RPAREN, 'Expected ) after expression')
      return expr
    }

    // Identifier
    if (this.match(TokenType.IDENTIFIER)) {
      const t = this.advance()
      return {
        type: 'Identifier',
        name: t.value,
        line: t.line,
        column: t.column
      } as IdentifierNode
    }

    this.error(`Unexpected token: ${token.type} (${token.value})`)
  }

  /**
   * Parse if expression: if condition then consequent else alternate
   */
  private parseIf(): IfNode {
    const ifToken = this.advance() // consume 'if'
    const condition = this.parseOr() // parse condition without catching 'then'

    // Expect 'then' keyword (as identifier)
    const thenToken = this.peek()
    if (thenToken.type !== TokenType.IDENTIFIER || thenToken.value !== 'then') {
      this.error("Expected 'then' after if condition")
    }
    this.advance() // consume 'then'

    const consequent = this.parseOr()

    let alternate: ASTNode | undefined

    // Check for 'else' keyword (as identifier)
    const elseToken = this.peek()
    if (elseToken.type === TokenType.IDENTIFIER && elseToken.value === 'else') {
      this.advance() // consume 'else'
      alternate = this.parseOr()
    } else if (elseToken.type === TokenType.ELSE) {
      this.advance() // consume 'else'
      alternate = this.parseOr()
    }

    return {
      type: 'If',
      condition,
      consequent,
      alternate,
      line: ifToken.line,
      column: ifToken.column
    }
  }

  /**
   * Parse match expression: match input { case pattern: body ... default: body }
   */
  private parseMatch(): MatchNode {
    const matchToken = this.advance() // consume 'match'
    const input = this.parsePrimary()

    this.consume(TokenType.LBRACE, "Expected '{' after match input")

    const cases: { pattern: ASTNode; body: ASTNode }[] = []
    let defaultCase: ASTNode | undefined

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      // Check for 'case' keyword (as identifier)
      const caseToken = this.peek()
      if (caseToken.type === TokenType.IDENTIFIER && caseToken.value === 'case') {
        this.advance() // consume 'case'
        const pattern = this.parseOr()
        this.consume(TokenType.COLON, "Expected ':' after case pattern")
        const body = this.parseOr()
        cases.push({ pattern, body })
      } else if (caseToken.type === TokenType.IDENTIFIER && caseToken.value === 'default') {
        this.advance() // consume 'default'
        this.consume(TokenType.COLON, "Expected ':' after default")
        defaultCase = this.parseOr()
      } else {
        break
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after match cases")

    return {
      type: 'Match',
      input,
      cases,
      default: defaultCase,
      line: matchToken.line,
      column: matchToken.column
    }
  }

  /**
   * Parse let binding: let name = value in body
   */
  private parseLet(): LetNode {
    const letToken = this.advance() // consume 'let'
    const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected variable name after let')
    this.consume(TokenType.ASSIGN, "Expected '=' after variable name")
    const value = this.parseOr()

    // Expect 'in' keyword (as identifier)
    const inToken = this.peek()
    if (inToken.type !== TokenType.IDENTIFIER || inToken.value !== 'in') {
      this.error("Expected 'in' after let value")
    }
    this.advance() // consume 'in'

    const body = this.parseExpression()

    return {
      type: 'Let',
      name: nameToken.value,
      value,
      body,
      line: letToken.line,
      column: letToken.column
    }
  }

  /**
   * Parse array literal: [elem1, elem2, ...]
   */
  private parseArray(): ArrayNode {
    const bracketToken = this.advance() // consume '['
    const elements: ASTNode[] = []

    if (!this.check(TokenType.RBRACKET)) {
      elements.push(this.parsePipe())

      while (this.match(TokenType.COMMA)) {
        this.advance()
        elements.push(this.parsePipe())
      }
    }

    this.consume(TokenType.RBRACKET, "Expected ']' after array elements")

    return {
      type: 'Array',
      elements,
      line: bracketToken.line,
      column: bracketToken.column
    }
  }

  /**
   * Parse object literal: {key: value, ...}
   */
  private parseObject(): ObjectNode {
    const braceToken = this.advance() // consume '{'
    const fields: { key: string; value: ASTNode }[] = []

    if (!this.check(TokenType.RBRACE)) {
      fields.push(this.parseObjectField())

      while (this.match(TokenType.COMMA)) {
        this.advance()
        fields.push(this.parseObjectField())
      }
    }

    this.consume(TokenType.RBRACE, "Expected '}' after object fields")

    return {
      type: 'Object',
      fields,
      line: braceToken.line,
      column: braceToken.column
    }
  }

  /**
   * Parse a single object field: key: value
   */
  private parseObjectField(): { key: string; value: ASTNode } {
    let key: string

    if (this.match(TokenType.STRING)) {
      const keyToken = this.advance()
      key = keyToken.value
    } else if (this.match(TokenType.IDENTIFIER)) {
      const keyToken = this.advance()
      key = keyToken.value
    } else {
      this.error('Expected object key (identifier or string)')
    }

    this.consume(TokenType.COLON, "Expected ':' after object key")
    const value = this.parsePipe()

    return { key, value }
  }
}

/**
 * Convenience function to parse a Bloblang expression
 */
export function parse(source: string): ASTNode {
  const lexer = new Lexer(source)
  const parser = new Parser(lexer)
  return parser.parse()
}

/**
 * Create a parser instance for a given source string
 */
export function createParser(source: string): Parser {
  return new Parser(new Lexer(source))
}
