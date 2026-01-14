/**
 * Bloblang Parser
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Recursive descent parser for the Bloblang language.
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

  parse(): ASTNode {
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

    statements.push(this.parseStatement())

    while (this.match(TokenType.SEMICOLON)) {
      this.advance()
      if (!this.check(TokenType.EOF)) {
        statements.push(this.parseStatement())
      }
    }

    if (!this.check(TokenType.EOF)) {
      const token = this.peek()
      throw new ParseError(
        `Unexpected token after expression: ${token.type} (${token.value})`,
        token.line,
        token.column
      )
    }

    if (statements.length === 1) {
      return statements[0]
    }

    return {
      type: 'Sequence',
      statements,
      line: startToken.line,
      column: startToken.column
    } as SequenceNode
  }

  private parseStatement(): ASTNode {
    return this.parseExpression()
  }

  private parseExpression(): ASTNode {
    return this.parseAssignment()
  }

  private parseAssignment(): ASTNode {
    const left = this.parsePipe()

    if (this.check(TokenType.ASSIGN)) {
      const assignToken = this.advance()
      const value = this.parsePipe()

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
        if (ma.property.type === 'Literal' && (ma.property as LiteralNode).kind === 'string') {
          return `${objectPath}["${(ma.property as LiteralNode).value}"]`
        }
        return null
      }
      case 'Call': {
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

  private parseArrow(): ASTNode {
    if (this.check(TokenType.IDENTIFIER)) {
      const next = this.peekNext()
      if (next.type === TokenType.ARROW) {
        const paramToken = this.advance()
        this.advance()
        const body = this.parseArrow()
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

  private parseComparison(): ASTNode {
    let left = this.parseAdditive()

    while (true) {
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

  private parseUnary(): ASTNode {
    if (this.match(TokenType.MINUS, TokenType.NOT)) {
      const opToken = this.advance()
      const operator = opToken.type === TokenType.MINUS ? '-' : '!'
      const operand = this.parseUnary()
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

  private parsePostfix(): ASTNode {
    let left = this.parsePrimary()

    while (true) {
      if (this.match(TokenType.DOT)) {
        const dotToken = this.advance()
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

  private parseArgumentList(): ASTNode[] {
    const args: ASTNode[] = []

    if (!this.check(TokenType.RPAREN)) {
      args.push(this.parsePipe())

      while (this.match(TokenType.COMMA)) {
        this.advance()
        args.push(this.parsePipe())
      }
    }

    return args
  }

  private parsePrimary(): ASTNode {
    const token = this.peek()

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

    if (this.match(TokenType.ROOT)) {
      const t = this.advance()
      return {
        type: 'Root',
        line: t.line,
        column: t.column
      } as RootNode
    }

    if (this.match(TokenType.THIS)) {
      const t = this.advance()
      return {
        type: 'This',
        line: t.line,
        column: t.column
      } as ThisNode
    }

    if (this.match(TokenType.META)) {
      const t = this.advance()
      return {
        type: 'Meta',
        line: t.line,
        column: t.column
      } as MetaNode
    }

    if (this.match(TokenType.DELETED)) {
      const t = this.advance()
      return {
        type: 'Deleted',
        line: t.line,
        column: t.column
      } as DeletedNode
    }

    if (this.match(TokenType.NOTHING)) {
      const t = this.advance()
      return {
        type: 'Nothing',
        line: t.line,
        column: t.column
      } as NothingNode
    }

    if (this.check(TokenType.MAP)) {
      const t = this.advance()
      return {
        type: 'Identifier',
        name: t.value,
        line: t.line,
        column: t.column
      } as IdentifierNode
    }

    if (this.match(TokenType.IF)) {
      return this.parseIf()
    }

    if (this.match(TokenType.MATCH)) {
      return this.parseMatch()
    }

    if (this.match(TokenType.LET)) {
      return this.parseLet()
    }

    if (this.match(TokenType.LBRACKET)) {
      return this.parseArray()
    }

    if (this.match(TokenType.LBRACE)) {
      return this.parseObject()
    }

    if (this.match(TokenType.LPAREN)) {
      this.advance()
      const expr = this.parseExpression()
      this.consume(TokenType.RPAREN, 'Expected ) after expression')
      return expr
    }

    if (this.match(TokenType.DOT)) {
      const dotToken = this.advance()

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

      return {
        type: 'Root',
        line: dotToken.line,
        column: dotToken.column
      } as RootNode
    }

    if (this.match(TokenType.IDENTIFIER)) {
      const t = this.advance()
      return {
        type: 'Identifier',
        name: t.value,
        line: t.line,
        column: t.column
      } as IdentifierNode
    }

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

  private parseIf(): IfNode {
    const ifToken = this.advance()

    const previousState = this.disableInOperator
    this.disableInOperator = false

    try {
      const condition = this.parseOr()

      const thenToken = this.peek()
      if (thenToken.type !== TokenType.IDENTIFIER || thenToken.value !== 'then') {
        this.error("Expected 'then' after if condition")
      }
      this.advance()

      const consequent = this.parseOr()

      let alternate: ASTNode | undefined

      const elseToken = this.peek()
      if (elseToken.type === TokenType.IDENTIFIER && elseToken.value === 'else') {
        this.advance()
        alternate = this.parseOr()
      } else if (elseToken.type === TokenType.ELSE) {
        this.advance()
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

  private parseMatch(): MatchNode {
    const matchToken = this.advance()
    // Parse the match input expression including member access (root.status, etc.)
    const input = this.parsePostfix()

    this.consume(TokenType.LBRACE, "Expected '{' after match input")

    const previousState = this.disableInOperator
    this.disableInOperator = false

    const cases: { pattern: ASTNode; body: ASTNode }[] = []
    let defaultCase: ASTNode | undefined

    try {
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        const caseToken = this.peek()
        if (caseToken.type === TokenType.IDENTIFIER && caseToken.value === 'case') {
          this.advance()
          const pattern = this.parseOr()
          this.consume(TokenType.COLON, "Expected ':' after case pattern")
          const body = this.parseOr()
          cases.push({ pattern, body })
        } else if (caseToken.type === TokenType.IDENTIFIER && caseToken.value === 'default') {
          this.advance()
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

  private parseLet(): ASTNode {
    const letToken = this.advance()
    const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected variable name after let')
    this.consume(TokenType.ASSIGN, "Expected '=' after variable name")
    const value = this.parseLetValue()

    const nextToken = this.peek()
    if (nextToken.type === TokenType.IN ||
        (nextToken.type === TokenType.IDENTIFIER && nextToken.value === 'in')) {
      this.advance()
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

    return {
      type: 'Assign',
      field: `$${nameToken.value}`,
      value,
      line: letToken.line,
      column: letToken.column
    } as AssignNode
  }

  private parseLetValue(): ASTNode {
    const previousState = this.disableInOperator
    this.disableInOperator = true
    try {
      return this.parseOr()
    } finally {
      this.disableInOperator = previousState
    }
  }

  private parseArray(): ArrayNode {
    const bracketToken = this.advance()
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

  private parseObject(): ObjectNode {
    const braceToken = this.advance()
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

  private parseObjectField(): { key: string; value: ASTNode } {
    let key: string

    if (this.match(TokenType.STRING)) {
      const keyToken = this.advance()
      key = keyToken.value
    } else if (this.match(TokenType.IDENTIFIER)) {
      const keyToken = this.advance()
      key = keyToken.value
    } else if (this.match(TokenType.ROOT, TokenType.THIS, TokenType.META, TokenType.IF, TokenType.MATCH, TokenType.LET, TokenType.MAP)) {
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

export function parse(source: string): ASTNode {
  const lexer = new Lexer(source)
  const parser = new Parser(lexer)
  return parser.parse()
}

export function createParser(source: string): Parser {
  return new Parser(new Lexer(source))
}
