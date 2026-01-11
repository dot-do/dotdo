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
  DeletedNode,
  NothingNode,
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
  SequenceNode,
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
  /**
   * When true, the 'in' operator is disabled in comparisons.
   * Used when parsing let binding values to avoid consuming 'in' as an operator.
   */
  private disableInOperator: boolean = false

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

  /**
   * Check if current token is a keyword that can be used as an identifier
   * (for property access like .deleted, .nothing, etc.)
   */
  private isKeywordAsIdentifier(): boolean {
    const type = this.peek().type
    return type === TokenType.DELETED ||
           type === TokenType.NOTHING ||
           type === TokenType.ERROR ||
           type === TokenType.ROOT ||
           type === TokenType.THIS ||
           type === TokenType.META ||
           type === TokenType.IF ||
           type === TokenType.ELSE ||
           type === TokenType.MATCH ||
           type === TokenType.LET ||
           type === TokenType.MAP ||
           type === TokenType.IN
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
   * Parse the source and return an AST node.
   * Handles multiple statements separated by semicolons.
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

    const statements: ASTNode[] = []
    const startToken = this.peek()

    // Parse first statement
    statements.push(this.parseStatement())

    // Parse additional statements separated by semicolons
    while (this.match(TokenType.SEMICOLON)) {
      this.advance() // consume ;
      // Don't require a statement after trailing semicolon
      if (!this.check(TokenType.EOF)) {
        statements.push(this.parseStatement())
      }
    }

    // Ensure we consumed all tokens (except EOF)
    if (!this.check(TokenType.EOF)) {
      const token = this.peek()
      throw new ParseError(
        `Unexpected token after expression: ${token.type} (${token.value})`,
        token.line,
        token.column
      )
    }

    // If there's only one statement, return it directly
    if (statements.length === 1) {
      return statements[0]
    }

    // Otherwise, return a Sequence node
    return {
      type: 'Sequence',
      statements,
      line: startToken.line,
      column: startToken.column
    } as SequenceNode
  }

  /**
   * Parse a single statement (expression or assignment)
   */
  private parseStatement(): ASTNode {
    return this.parseExpression()
  }

  /**
   * Parse a complete expression (may include assignment)
   */
  private parseExpression(): ASTNode {
    return this.parseAssignment()
  }

  /**
   * Parse assignment: target = expression
   * Supports: root = expr, root.field = expr, identifier = expr, meta("key") = expr
   */
  private parseAssignment(): ASTNode {
    // Parse the left side first
    const left = this.parsePipe()

    // Check if this is an assignment
    if (this.check(TokenType.ASSIGN)) {
      const assignToken = this.advance() // consume =
      const value = this.parsePipe()

      // Convert the left side to a field path for AssignNode
      const field = this.astToFieldPath(left)
      if (field === null) {
        throw new ParseError(
          'Invalid assignment target',
          assignToken.line,
          assignToken.column
        )
      }

      return {
        type: 'Assign',
        field,
        value,
        line: left.line,
        column: left.column
      } as AssignNode
    }

    return left
  }

  /**
   * Convert an AST node to a field path string for assignment.
   * Returns null if the node is not a valid assignment target.
   */
  private astToFieldPath(node: ASTNode): string | null {
    switch (node.type) {
      case 'Root':
        return 'root'
      case 'Identifier':
        return (node as IdentifierNode).name
      case 'MemberAccess': {
        const ma = node as MemberAccessNode
        const objectPath = this.astToFieldPath(ma.object)
        if (objectPath === null) return null
        if (typeof ma.property === 'string') {
          return `${objectPath}.${ma.property}`
        }
        // Bracket access with expression - convert if it's a string literal
        if (ma.property.type === 'Literal' && (ma.property as LiteralNode).kind === 'string') {
          return `${objectPath}["${(ma.property as LiteralNode).value}"]`
        }
        return null
      }
      case 'Call': {
        // Handle meta("key") = expr
        const call = node as CallNode
        if (call.function.type === 'Meta' && call.arguments.length === 1) {
          const arg = call.arguments[0]
          if (arg.type === 'Literal' && (arg as LiteralNode).kind === 'string') {
            return `meta("${(arg as LiteralNode).value}")`
          }
        }
        return null
      }
      default:
        return null
    }
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
   * Parse comparison: expr < expr, expr > expr, expr <= expr, expr >= expr, expr in array
   * Note: 'in' operator is disabled when disableInOperator flag is true (for let binding values)
   */
  private parseComparison(): ASTNode {
    let left = this.parseAdditive()

    while (true) {
      // Check for standard comparison operators
      if (this.match(TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE)) {
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
      } else if (!this.disableInOperator && this.match(TokenType.IN)) {
        // Handle 'in' operator for membership check (only when not disabled)
        const opToken = this.advance()
        const right = this.parseAdditive()
        left = {
          type: 'BinaryOp',
          operator: 'in' as BinaryOperator,
          left,
          right,
          line: opToken.line,
          column: opToken.column
        } as BinaryOpNode
      } else {
        break
      }
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
        // Allow keywords as property names (e.g., .map(), .length(), .deleted)
        let propName: string
        if (this.match(TokenType.IDENTIFIER) || this.isKeywordAsIdentifier()) {
          propName = this.advance().value
        } else {
          this.error('Expected property name after .')
        }
        left = {
          type: 'MemberAccess',
          object: left,
          property: propName,
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

    // Deleted marker (for removing fields in mappings)
    if (this.match(TokenType.DELETED)) {
      const t = this.advance()
      return {
        type: 'Deleted',
        line: t.line,
        column: t.column
      } as DeletedNode
    }

    // Nothing marker (for null/absent values)
    if (this.match(TokenType.NOTHING)) {
      const t = this.advance()
      return {
        type: 'Nothing',
        line: t.line,
        column: t.column
      } as NothingNode
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

    // Shorthand field access: .field is equivalent to root.field
    // Also handle . by itself as equivalent to root
    if (this.match(TokenType.DOT)) {
      const dotToken = this.advance()

      // Check if there's an identifier (or keyword used as identifier) after the dot
      if (this.check(TokenType.IDENTIFIER) || this.isKeywordAsIdentifier()) {
        const propToken = this.advance()
        return {
          type: 'MemberAccess',
          object: {
            type: 'Root',
            line: dotToken.line,
            column: dotToken.column
          } as RootNode,
          property: propToken.value,
          accessType: 'dot',
          line: dotToken.line,
          column: dotToken.column
        } as MemberAccessNode
      }

      // If no identifier follows, . means root
      return {
        type: 'Root',
        line: dotToken.line,
        column: dotToken.column
      } as RootNode
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

    // Environment variable or local variable reference ($varname)
    if (this.match(TokenType.ENV_VAR)) {
      const t = this.advance()
      return {
        type: 'Identifier',
        name: `$${t.value}`,
        line: t.line,
        column: t.column
      } as IdentifierNode
    }

    this.error(`Unexpected token: ${token.type} (${token.value})`)
  }

  /**
   * Parse if expression: if condition then consequent else alternate
   * Note: If expressions create their own parsing scope where 'in' operator is allowed,
   * even when nested inside let bindings (to maintain backwards compatibility).
   */
  private parseIf(): IfNode {
    const ifToken = this.advance() // consume 'if'

    // Temporarily enable 'in' operator inside if expressions (backwards compat)
    const previousState = this.disableInOperator
    this.disableInOperator = false

    try {
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
    } finally {
      this.disableInOperator = previousState
    }
  }

  /**
   * Parse match expression: match input { case pattern: body ... default: body }
   * Note: Match expressions create their own parsing scope where 'in' operator is allowed,
   * even when nested inside let bindings (to maintain backwards compatibility).
   */
  private parseMatch(): MatchNode {
    const matchToken = this.advance() // consume 'match'
    const input = this.parsePrimary()

    this.consume(TokenType.LBRACE, "Expected '{' after match input")

    // Temporarily enable 'in' operator inside match expressions (backwards compat)
    const previousState = this.disableInOperator
    this.disableInOperator = false

    const cases: { pattern: ASTNode; body: ASTNode }[] = []
    let defaultCase: ASTNode | undefined

    try {
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
    } finally {
      this.disableInOperator = previousState
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
   * OR variable declaration: let name = value (followed by ; or EOF)
   */
  private parseLet(): ASTNode {
    const letToken = this.advance() // consume 'let'
    const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected variable name after let')
    this.consume(TokenType.ASSIGN, "Expected '=' after variable name")
    // Parse value without allowing the 'in' operator (to avoid consuming 'in' keyword)
    const value = this.parseLetValue()

    // Check if this is 'let x = val in body' or 'let x = val;' (statement style)
    const nextToken = this.peek()
    if (nextToken.type === TokenType.IN ||
        (nextToken.type === TokenType.IDENTIFIER && nextToken.value === 'in')) {
      // Functional style: let x = val in body
      this.advance() // consume 'in'
      const body = this.parseExpression()

      return {
        type: 'Let',
        name: nameToken.value,
        value,
        body,
        line: letToken.line,
        column: letToken.column
      } as LetNode
    }

    // Statement style: let x = val (followed by ; or EOF)
    // Return a special VariableDecl-like node using Assign with a $ prefix
    return {
      type: 'Assign',
      field: `$${nameToken.value}`,
      value,
      line: letToken.line,
      column: letToken.column
    } as AssignNode
  }

  /**
   * Parse a let binding value expression (without the 'in' operator)
   * Uses the disableInOperator flag to prevent 'in' from being consumed as an operator
   */
  private parseLetValue(): ASTNode {
    const previousState = this.disableInOperator
    this.disableInOperator = true
    try {
      return this.parseOr()
    } finally {
      this.disableInOperator = previousState
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
    } else if (this.match(TokenType.ROOT, TokenType.THIS, TokenType.META, TokenType.IF, TokenType.MATCH, TokenType.LET, TokenType.MAP)) {
      // Allow keywords as object keys
      const keyToken = this.advance()
      key = keyToken.value || keyToken.type.toLowerCase()
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
