/**
 * Python AST Parser
 *
 * A recursive descent parser for Python source code.
 */

import type {
  ModuleNode,
  StatementNode,
  ExpressionNode,
  ImportNode,
  ImportFromNode,
  AliasNode,
  FunctionDefNode,
  ArgumentsNode,
  ArgNode,
  ClassDefNode,
  IfNode,
  ForNode,
  WhileNode,
  WithNode,
  WithItemNode,
  MatchNode,
  MatchCaseNode,
  PatternNode,
  TryNode,
  ExceptHandlerNode,
  RaiseNode,
  ReturnNode,
  DeleteNode,
  GlobalNode,
  NonlocalNode,
  AssertNode,
  TypeAliasNode,
  LambdaNode,
  ComprehensionNode,
  CallNode,
  KeywordNode,
  FormattedValueNode,
  JoinedStrNode,
  ConstantNode,
  SubscriptNode,
  NameNode,
  OperatorType,
  CompareOperatorType,
} from './types.js'

// Token types
type TokenType =
  | 'NAME'
  | 'NUMBER'
  | 'STRING'
  | 'FSTRING_START'
  | 'FSTRING_MIDDLE'
  | 'FSTRING_END'
  | 'OP'
  | 'NEWLINE'
  | 'INDENT'
  | 'DEDENT'
  | 'ENDMARKER'
  | 'NL'
  | 'COMMENT'
  | 'ERRORTOKEN'

interface Token {
  type: TokenType
  value: string
  start: [number, number]
  end: [number, number]
}

// Tokenizer
class Tokenizer {
  private source: string
  private pos = 0
  private line = 1
  private col = 0
  private indentStack: number[] = [0]
  private pendingTokens: Token[] = []
  private atLineStart = true

  constructor(source: string) {
    this.source = source
  }

  peek(): Token {
    if (this.pendingTokens.length > 0) {
      return this.pendingTokens[0]
    }
    const token = this.nextToken()
    this.pendingTokens.push(token)
    return token
  }

  next(): Token {
    if (this.pendingTokens.length > 0) {
      return this.pendingTokens.shift()!
    }
    return this.nextToken()
  }

  private nextToken(): Token {
    // Skip whitespace (but track indentation at line start)
    if (this.atLineStart) {
      return this.handleIndentation()
    }

    this.skipWhitespace()

    if (this.pos >= this.source.length) {
      // Emit any remaining DEDENTs
      if (this.indentStack.length > 1) {
        this.indentStack.pop()
        return this.makeToken('DEDENT', '')
      }
      return this.makeToken('ENDMARKER', '')
    }

    const ch = this.source[this.pos]

    // Comments
    if (ch === '#') {
      while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
        this.pos++
        this.col++
      }
      return this.nextToken()
    }

    // Newline
    if (ch === '\n') {
      this.pos++
      this.line++
      this.col = 0
      this.atLineStart = true
      return this.makeToken('NEWLINE', '\n')
    }

    // Carriage return
    if (ch === '\r') {
      this.pos++
      if (this.source[this.pos] === '\n') {
        this.pos++
      }
      this.line++
      this.col = 0
      this.atLineStart = true
      return this.makeToken('NEWLINE', '\n')
    }

    // String literals
    if (ch === '"' || ch === "'") {
      return this.readString()
    }

    // F-string
    if ((ch === 'f' || ch === 'F') && (this.source[this.pos + 1] === '"' || this.source[this.pos + 1] === "'")) {
      return this.readFString()
    }

    // Raw string
    if ((ch === 'r' || ch === 'R') && (this.source[this.pos + 1] === '"' || this.source[this.pos + 1] === "'")) {
      return this.readRawString()
    }

    // Byte string
    if ((ch === 'b' || ch === 'B') && (this.source[this.pos + 1] === '"' || this.source[this.pos + 1] === "'")) {
      return this.readByteString()
    }

    // Raw f-string (rf"..." or fr"...")
    if ((ch === 'r' || ch === 'R') && (this.source[this.pos + 1] === 'f' || this.source[this.pos + 1] === 'F') &&
        (this.source[this.pos + 2] === '"' || this.source[this.pos + 2] === "'")) {
      this.pos += 2
      this.col += 2
      return this.readFStringContent()
    }

    if ((ch === 'f' || ch === 'F') && (this.source[this.pos + 1] === 'r' || this.source[this.pos + 1] === 'R') &&
        (this.source[this.pos + 2] === '"' || this.source[this.pos + 2] === "'")) {
      this.pos += 2
      this.col += 2
      return this.readFStringContent()
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      return this.readNumber()
    }

    // Dot (could be number or operator)
    if (ch === '.' && this.source[this.pos + 1] >= '0' && this.source[this.pos + 1] <= '9') {
      return this.readNumber()
    }

    // Names/keywords
    if (this.isNameStart(ch)) {
      return this.readName()
    }

    // Operators and delimiters
    return this.readOperator()
  }

  private handleIndentation(): Token {
    let indent = 0
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === ' ') {
        indent++
        this.pos++
        this.col++
      } else if (ch === '\t') {
        indent = ((indent / 8) | 0) * 8 + 8
        this.pos++
        this.col++
      } else if (ch === '\n' || ch === '\r') {
        // Blank line, skip it
        if (ch === '\r' && this.source[this.pos + 1] === '\n') {
          this.pos++
        }
        this.pos++
        this.line++
        this.col = 0
        indent = 0
        continue
      } else if (ch === '#') {
        // Comment line, skip to end
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.pos++
          this.col++
        }
        continue
      } else {
        break
      }
    }

    this.atLineStart = false

    if (this.pos >= this.source.length) {
      // End of file - emit DEDENTs
      if (this.indentStack.length > 1) {
        this.indentStack.pop()
        return this.makeToken('DEDENT', '')
      }
      return this.makeToken('ENDMARKER', '')
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1]

    if (indent > currentIndent) {
      this.indentStack.push(indent)
      return this.makeToken('INDENT', '')
    } else if (indent < currentIndent) {
      // May need multiple DEDENTs
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indent) {
        this.indentStack.pop()
        this.pendingTokens.push(this.makeToken('DEDENT', ''))
      }
      return this.pendingTokens.shift()!
    }

    // Same indentation level, continue with next token
    return this.nextToken()
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === ' ' || ch === '\t') {
        this.pos++
        this.col++
      } else if (ch === '\\' && this.source[this.pos + 1] === '\n') {
        // Line continuation
        this.pos += 2
        this.line++
        this.col = 0
      } else {
        break
      }
    }
  }

  private readString(): Token {
    const quote = this.source[this.pos]
    const startPos = this.pos
    const startCol = this.col
    this.pos++
    this.col++

    // Check for triple quotes
    let triple = false
    if (this.source[this.pos] === quote && this.source[this.pos + 1] === quote) {
      triple = true
      this.pos += 2
      this.col += 2
    }

    let value = ''
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === '\\') {
        value += ch + this.source[this.pos + 1]
        this.pos += 2
        this.col += 2
        if (this.source[this.pos - 1] === '\n') {
          this.line++
          this.col = 0
        }
      } else if (ch === quote) {
        if (triple) {
          if (this.source[this.pos + 1] === quote && this.source[this.pos + 2] === quote) {
            this.pos += 3
            this.col += 3
            break
          }
          value += ch
          this.pos++
          this.col++
        } else {
          this.pos++
          this.col++
          break
        }
      } else if (ch === '\n' && !triple) {
        throw new SyntaxError('EOL while scanning string literal')
      } else {
        if (ch === '\n') {
          this.line++
          this.col = 0
        }
        value += ch
        this.pos++
        this.col++
      }
    }

    return {
      type: 'STRING',
      value: this.source.slice(startPos, this.pos),
      start: [this.line, startCol],
      end: [this.line, this.col],
    }
  }

  private readRawString(): Token {
    const startPos = this.pos
    this.pos++ // skip 'r'
    this.col++
    const quote = this.source[this.pos]
    this.pos++
    this.col++

    let triple = false
    if (this.source[this.pos] === quote && this.source[this.pos + 1] === quote) {
      triple = true
      this.pos += 2
      this.col += 2
    }

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === quote) {
        if (triple) {
          if (this.source[this.pos + 1] === quote && this.source[this.pos + 2] === quote) {
            this.pos += 3
            this.col += 3
            break
          }
        } else {
          this.pos++
          this.col++
          break
        }
      }
      if (ch === '\n') {
        this.line++
        this.col = 0
      }
      this.pos++
      this.col++
    }

    return {
      type: 'STRING',
      value: this.source.slice(startPos, this.pos),
      start: [this.line, this.col],
      end: [this.line, this.col],
    }
  }

  private readByteString(): Token {
    const startPos = this.pos
    this.pos++ // skip 'b'
    this.col++
    return { ...this.readString(), value: this.source.slice(startPos, this.pos) }
  }

  private readFString(): Token {
    this.pos++ // skip 'f'
    this.col++
    return this.readFStringContent()
  }

  private readFStringContent(): Token {
    const startPos = this.pos - 1
    const quote = this.source[this.pos]
    this.pos++
    this.col++

    let triple = false
    if (this.source[this.pos] === quote && this.source[this.pos + 1] === quote) {
      triple = true
      this.pos += 2
      this.col += 2
    }

    let braceDepth = 0
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === '{') {
        if (this.source[this.pos + 1] === '{') {
          this.pos += 2
          this.col += 2
          continue
        }
        braceDepth++
      } else if (ch === '}') {
        if (this.source[this.pos + 1] === '}') {
          this.pos += 2
          this.col += 2
          continue
        }
        if (braceDepth > 0) braceDepth--
      } else if (ch === quote && braceDepth === 0) {
        if (triple) {
          if (this.source[this.pos + 1] === quote && this.source[this.pos + 2] === quote) {
            this.pos += 3
            this.col += 3
            break
          }
        } else {
          this.pos++
          this.col++
          break
        }
      } else if (ch === '\n') {
        this.line++
        this.col = 0
      }
      this.pos++
      this.col++
    }

    return {
      type: 'STRING',
      value: this.source.slice(startPos, this.pos),
      start: [this.line, this.col],
      end: [this.line, this.col],
    }
  }

  private readNumber(): Token {
    const startPos = this.pos
    const startCol = this.col

    // Check for 0x, 0o, 0b prefixes
    if (this.source[this.pos] === '0') {
      const next = this.source[this.pos + 1]?.toLowerCase()
      if (next === 'x' || next === 'o' || next === 'b') {
        this.pos += 2
        this.col += 2
        while (this.pos < this.source.length && this.isAlphaNum(this.source[this.pos])) {
          this.pos++
          this.col++
        }
        return {
          type: 'NUMBER',
          value: this.source.slice(startPos, this.pos),
          start: [this.line, startCol],
          end: [this.line, this.col],
        }
      }
    }

    // Regular number (int or float)
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch >= '0' && ch <= '9') {
        this.pos++
        this.col++
      } else if (ch === '_') {
        this.pos++
        this.col++
      } else {
        break
      }
    }

    // Decimal point
    if (this.source[this.pos] === '.' && this.source[this.pos + 1] !== '.') {
      this.pos++
      this.col++
      while (this.pos < this.source.length) {
        const ch = this.source[this.pos]
        if ((ch >= '0' && ch <= '9') || ch === '_') {
          this.pos++
          this.col++
        } else {
          break
        }
      }
    }

    // Exponent
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      this.pos++
      this.col++
      if (this.source[this.pos] === '+' || this.source[this.pos] === '-') {
        this.pos++
        this.col++
      }
      while (this.pos < this.source.length) {
        const ch = this.source[this.pos]
        if ((ch >= '0' && ch <= '9') || ch === '_') {
          this.pos++
          this.col++
        } else {
          break
        }
      }
    }

    // Complex number suffix
    if (this.source[this.pos] === 'j' || this.source[this.pos] === 'J') {
      this.pos++
      this.col++
    }

    return {
      type: 'NUMBER',
      value: this.source.slice(startPos, this.pos),
      start: [this.line, startCol],
      end: [this.line, this.col],
    }
  }

  private readName(): Token {
    const startPos = this.pos
    const startCol = this.col

    while (this.pos < this.source.length && this.isNameChar(this.source[this.pos])) {
      this.pos++
      this.col++
    }

    return {
      type: 'NAME',
      value: this.source.slice(startPos, this.pos),
      start: [this.line, startCol],
      end: [this.line, this.col],
    }
  }

  private readOperator(): Token {
    const startCol = this.col

    // Three-character operators
    const three = this.source.slice(this.pos, this.pos + 3)
    if (['...', '**=', '//=', '>>=', '<<='].includes(three)) {
      this.pos += 3
      this.col += 3
      return { type: 'OP', value: three, start: [this.line, startCol], end: [this.line, this.col] }
    }

    // Two-character operators
    const two = this.source.slice(this.pos, this.pos + 2)
    if (
      ['==', '!=', '<=', '>=', '<<', '>>', '**', '//', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', ':='].includes(
        two
      )
    ) {
      this.pos += 2
      this.col += 2
      return { type: 'OP', value: two, start: [this.line, startCol], end: [this.line, this.col] }
    }

    // Single-character operators
    const one = this.source[this.pos]
    this.pos++
    this.col++
    return { type: 'OP', value: one, start: [this.line, startCol], end: [this.line, this.col] }
  }

  private makeToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      start: [this.line, this.col],
      end: [this.line, this.col],
    }
  }

  private isNameStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
  }

  private isNameChar(ch: string): boolean {
    return this.isNameStart(ch) || (ch >= '0' && ch <= '9')
  }

  private isAlphaNum(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') || ch === '_'
  }
}

// Parser
export class Parser {
  private tokenizer: Tokenizer
  private currentToken: Token

  constructor(source: string) {
    this.tokenizer = new Tokenizer(source)
    this.currentToken = this.tokenizer.next()
  }

  parse(): ModuleNode {
    const body: StatementNode[] = []

    while (this.currentToken.type !== 'ENDMARKER') {
      if (this.currentToken.type === 'NEWLINE' || this.currentToken.type === 'NL') {
        this.advance()
        continue
      }
      const stmt = this.parseStatement()
      if (stmt) {
        body.push(stmt)
      }
    }

    return { type: 'Module', body }
  }

  parseExpression(): ExpressionNode {
    return this.parseExpr()
  }

  private advance(): Token {
    const token = this.currentToken
    this.currentToken = this.tokenizer.next()
    return token
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.currentToken
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new SyntaxError(`Expected ${value ?? type}, got ${token.value}`)
    }
    this.advance()
    return token
  }

  private match(type: TokenType, value?: string): boolean {
    return this.currentToken.type === type && (value === undefined || this.currentToken.value === value)
  }

  private matchKeyword(keyword: string): boolean {
    return this.currentToken.type === 'NAME' && this.currentToken.value === keyword
  }

  // ============== Statement Parsing ==============

  private parseStatement(): StatementNode | null {
    // Handle decorators
    if (this.match('OP', '@')) {
      return this.parseDecorated()
    }

    // Handle compound statements
    if (this.matchKeyword('def')) return this.parseFunctionDef()
    if (this.matchKeyword('async')) return this.parseAsyncStatement()
    if (this.matchKeyword('class')) return this.parseClassDef()
    if (this.matchKeyword('if')) return this.parseIf()
    if (this.matchKeyword('for')) return this.parseFor()
    if (this.matchKeyword('while')) return this.parseWhile()
    if (this.matchKeyword('with')) return this.parseWith()
    if (this.matchKeyword('match')) return this.parseMatch()
    if (this.matchKeyword('try')) return this.parseTry()
    if (this.matchKeyword('type')) return this.parseTypeAlias()

    // Simple statements
    return this.parseSimpleStatement()
  }

  private parseSimpleStatement(): StatementNode | null {
    let stmt: StatementNode | null = null

    if (this.matchKeyword('import')) {
      stmt = this.parseImport()
    } else if (this.matchKeyword('from')) {
      stmt = this.parseFromImport()
    } else if (this.matchKeyword('pass')) {
      this.advance()
      stmt = { type: 'Pass' }
    } else if (this.matchKeyword('break')) {
      this.advance()
      stmt = { type: 'Break' }
    } else if (this.matchKeyword('continue')) {
      this.advance()
      stmt = { type: 'Continue' }
    } else if (this.matchKeyword('return')) {
      stmt = this.parseReturn()
    } else if (this.matchKeyword('raise')) {
      stmt = this.parseRaise()
    } else if (this.matchKeyword('global')) {
      stmt = this.parseGlobal()
    } else if (this.matchKeyword('nonlocal')) {
      stmt = this.parseNonlocal()
    } else if (this.matchKeyword('assert')) {
      stmt = this.parseAssert()
    } else if (this.matchKeyword('del')) {
      stmt = this.parseDelete()
    } else {
      stmt = this.parseExpressionStatement()
    }

    // Consume NEWLINE
    if (this.currentToken.type === 'NEWLINE') {
      this.advance()
    }

    return stmt
  }

  private parseDecorated(): FunctionDefNode | ClassDefNode {
    const decorators: ExpressionNode[] = []

    while (this.match('OP', '@')) {
      this.advance() // consume @
      decorators.push(this.parseExpr())
      if (this.currentToken.type === 'NEWLINE') {
        this.advance()
      }
    }

    let node: FunctionDefNode | ClassDefNode
    if (this.matchKeyword('async')) {
      this.advance()
      if (this.matchKeyword('def')) {
        node = this.parseFunctionDef(true)
      } else {
        throw new SyntaxError('Expected def after async')
      }
    } else if (this.matchKeyword('def')) {
      node = this.parseFunctionDef()
    } else if (this.matchKeyword('class')) {
      node = this.parseClassDef()
    } else {
      throw new SyntaxError('Expected class or def after decorator')
    }

    node.decorator_list = decorators
    return node
  }

  private parseAsyncStatement(): FunctionDefNode | ForNode | WithNode {
    this.advance() // consume 'async'
    if (this.matchKeyword('def')) {
      return this.parseFunctionDef(true)
    } else if (this.matchKeyword('for')) {
      return this.parseFor(true)
    } else if (this.matchKeyword('with')) {
      return this.parseWith(true)
    }
    throw new SyntaxError('Expected def, for, or with after async')
  }

  private parseImport(): ImportNode {
    this.advance() // consume 'import'
    const names: AliasNode[] = []

    do {
      if (names.length > 0 && this.match('OP', ',')) {
        this.advance()
      }
      const name = this.parseDottedName()
      let asname: string | undefined
      if (this.matchKeyword('as')) {
        this.advance()
        asname = this.expect('NAME').value
      }
      names.push({ type: 'alias', name, asname })
    } while (this.match('OP', ','))

    return { type: 'Import', names }
  }

  private parseFromImport(): ImportFromNode {
    this.advance() // consume 'from'

    let level = 0
    while (this.match('OP', '.') || this.match('OP', '...')) {
      if (this.currentToken.value === '...') {
        level += 3
      } else {
        level += 1
      }
      this.advance()
    }

    let module: string | null = null
    if (this.currentToken.type === 'NAME' && !this.matchKeyword('import')) {
      module = this.parseDottedNameUntilImport()
    }

    this.expect('NAME', 'import')

    const names: AliasNode[] = []

    if (this.match('OP', '*')) {
      this.advance()
      names.push({ type: 'alias', name: '*' })
    } else if (this.match('OP', '(')) {
      this.advance()
      do {
        if (this.match('OP', ',')) this.advance()
        if (this.match('OP', ')')) break
        const name = this.expect('NAME').value
        let asname: string | undefined
        if (this.matchKeyword('as')) {
          this.advance()
          asname = this.expect('NAME').value
        }
        names.push({ type: 'alias', name, asname })
      } while (this.match('OP', ','))
      this.expect('OP', ')')
    } else {
      do {
        if (names.length > 0) {
          this.expect('OP', ',')
        }
        const name = this.expect('NAME').value
        let asname: string | undefined
        if (this.matchKeyword('as')) {
          this.advance()
          asname = this.expect('NAME').value
        }
        names.push({ type: 'alias', name, asname })
      } while (this.match('OP', ','))
    }

    return { type: 'ImportFrom', module: module ?? '', names, level }
  }

  private parseDottedName(): string {
    let name = this.expect('NAME').value
    while (this.match('OP', '.')) {
      this.advance()
      // Stop if the next token is a keyword like 'import'
      if (this.isKeyword(this.currentToken.value)) {
        throw new SyntaxError(`Unexpected keyword ${this.currentToken.value} in dotted name`)
      }
      name += '.' + this.expect('NAME').value
    }
    return name
  }

  private parseDottedNameUntilImport(): string {
    let name = this.expect('NAME').value
    while (this.match('OP', '.') && !this.matchKeyword('import')) {
      this.advance()
      // Stop if the next token is 'import'
      if (this.matchKeyword('import')) {
        break
      }
      name += '.' + this.expect('NAME').value
    }
    return name
  }

  private isKeyword(value: string): boolean {
    const keywords = [
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
      'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
      'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
      'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
      'while', 'with', 'yield', 'match', 'case', 'type'
    ]
    return keywords.includes(value)
  }

  private parseFunctionDef(isAsync = false): FunctionDefNode {
    this.advance() // consume 'def'
    const name = this.expect('NAME').value

    // Check for type parameters [T, U, ...]
    let typeParams: any[] = []
    if (this.match('OP', '[')) {
      typeParams = this.parseTypeParams()
    }

    this.expect('OP', '(')
    const args = this.parseArguments()
    this.expect('OP', ')')

    let returns: ExpressionNode | undefined
    if (this.match('OP', '->')) {
      this.advance()
      returns = this.parseExpr()
    }

    this.expect('OP', ':')
    const body = this.parseSuite()

    const node: FunctionDefNode = {
      type: isAsync ? 'AsyncFunctionDef' : 'FunctionDef',
      name,
      args,
      body,
      decorator_list: [],
      returns,
    }

    if (typeParams.length > 0) {
      node.type_params = typeParams
    }

    return node
  }

  private parseTypeParams(): any[] {
    this.advance() // consume '['
    const params: any[] = []

    while (!this.match('OP', ']')) {
      if (params.length > 0) {
        this.expect('OP', ',')
      }
      const name = this.expect('NAME').value
      params.push({ type: 'TypeVar', name })
    }

    this.expect('OP', ']')
    return params
  }

  private parseArguments(): ArgumentsNode {
    const args: ArgNode[] = []
    const defaults: ExpressionNode[] = []
    const kwonlyargs: ArgNode[] = []
    const kwDefaults: (ExpressionNode | null)[] = []
    let vararg: ArgNode | undefined
    let kwarg: ArgNode | undefined
    let seenStar = false

    while (!this.match('OP', ')')) {
      if (args.length > 0 || kwonlyargs.length > 0 || vararg || kwarg || seenStar) {
        if (!this.match('OP', ',')) break
        this.advance()
        if (this.match('OP', ')')) break
      }

      // **kwargs
      if (this.match('OP', '**')) {
        this.advance()
        const argName = this.expect('NAME').value
        let annotation: ExpressionNode | undefined
        if (this.match('OP', ':')) {
          this.advance()
          annotation = this.parseExpr()
        }
        kwarg = { type: 'arg', arg: argName, annotation }
        continue
      }

      // *args or bare *
      if (this.match('OP', '*')) {
        this.advance()
        seenStar = true
        if (this.match('NAME')) {
          const argName = this.expect('NAME').value
          let annotation: ExpressionNode | undefined
          if (this.match('OP', ':')) {
            this.advance()
            annotation = this.parseExpr()
          }
          vararg = { type: 'arg', arg: argName, annotation }
        }
        continue
      }

      // Regular argument
      const argName = this.expect('NAME').value
      let annotation: ExpressionNode | undefined
      if (this.match('OP', ':')) {
        this.advance()
        annotation = this.parseExpr()
      }

      const arg: ArgNode = { type: 'arg', arg: argName, annotation }

      // Default value
      if (this.match('OP', '=')) {
        this.advance()
        const defaultVal = this.parseExpr()
        if (seenStar) {
          kwonlyargs.push(arg)
          kwDefaults.push(defaultVal)
        } else {
          args.push(arg)
          defaults.push(defaultVal)
        }
      } else {
        if (seenStar) {
          kwonlyargs.push(arg)
          kwDefaults.push(null)
        } else {
          args.push(arg)
        }
      }
    }

    return {
      type: 'arguments',
      posonlyargs: [],
      args,
      vararg,
      kwonlyargs,
      kw_defaults: kwDefaults,
      kwarg,
      defaults,
    }
  }

  private parseClassDef(): ClassDefNode {
    this.advance() // consume 'class'
    const name = this.expect('NAME').value

    // Check for type parameters [T, U, ...]
    let typeParams: any[] = []
    if (this.match('OP', '[')) {
      typeParams = this.parseTypeParams()
    }

    const bases: ExpressionNode[] = []
    const keywords: KeywordNode[] = []

    if (this.match('OP', '(')) {
      this.advance()
      while (!this.match('OP', ')')) {
        if (bases.length > 0 || keywords.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', ')')) break
        }

        // Check for keyword argument (name=value)
        if (this.currentToken.type === 'NAME' && this.tokenizer.peek().value === '=') {
          const argName = this.advance().value
          this.advance() // consume '='
          const value = this.parseExpr()
          keywords.push({ type: 'keyword', arg: argName, value })
        } else {
          bases.push(this.parseExpr())
        }
      }
      this.expect('OP', ')')
    }

    this.expect('OP', ':')
    const body = this.parseSuite()

    const node: ClassDefNode = {
      type: 'ClassDef',
      name,
      bases,
      keywords,
      body,
      decorator_list: [],
    }

    if (typeParams.length > 0) {
      node.type_params = typeParams
    }

    return node
  }

  private parseIf(): IfNode {
    this.advance() // consume 'if'
    const test = this.parseExpr()
    this.expect('OP', ':')
    const body = this.parseSuite()

    let orelse: StatementNode[] = []

    if (this.matchKeyword('elif')) {
      orelse = [this.parseElif()]
    } else if (this.matchKeyword('else')) {
      this.advance()
      this.expect('OP', ':')
      orelse = this.parseSuite()
    }

    return { type: 'If', test, body, orelse }
  }

  private parseElif(): IfNode {
    this.advance() // consume 'elif'
    const test = this.parseExpr()
    this.expect('OP', ':')
    const body = this.parseSuite()

    let orelse: StatementNode[] = []

    if (this.matchKeyword('elif')) {
      orelse = [this.parseElif()]
    } else if (this.matchKeyword('else')) {
      this.advance()
      this.expect('OP', ':')
      orelse = this.parseSuite()
    }

    return { type: 'If', test, body, orelse }
  }

  private parseFor(isAsync = false): ForNode {
    this.advance() // consume 'for'
    const target = this.parseTargetList()
    this.expect('NAME', 'in')
    const iter = this.parseExpr()
    this.expect('OP', ':')
    const body = this.parseSuite()

    let orelse: StatementNode[] = []
    if (this.matchKeyword('else')) {
      this.advance()
      this.expect('OP', ':')
      orelse = this.parseSuite()
    }

    return {
      type: isAsync ? 'AsyncFor' : 'For',
      target,
      iter,
      body,
      orelse,
    }
  }

  private parseTargetList(): ExpressionNode {
    // Parse a target expression that stops at 'in' keyword
    const first = this.parseTarget()

    if (this.match('OP', ',')) {
      const elts = [first]
      while (this.match('OP', ',')) {
        this.advance()
        if (this.matchKeyword('in')) break
        elts.push(this.parseTarget())
      }
      return { type: 'Tuple', elts }
    }

    return first
  }

  private parseTarget(): ExpressionNode {
    // Parse a single target (name, tuple, list, attribute, subscript, starred)
    if (this.match('OP', '*')) {
      this.advance()
      return { type: 'Starred', value: this.parseTarget() }
    }

    if (this.match('OP', '(')) {
      this.advance()
      const elts: ExpressionNode[] = []
      while (!this.match('OP', ')')) {
        if (elts.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', ')')) break
        }
        elts.push(this.parseTarget())
      }
      this.expect('OP', ')')
      return { type: 'Tuple', elts }
    }

    if (this.match('OP', '[')) {
      this.advance()
      const elts: ExpressionNode[] = []
      while (!this.match('OP', ']')) {
        if (elts.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', ']')) break
        }
        elts.push(this.parseTarget())
      }
      this.expect('OP', ']')
      return { type: 'List', elts }
    }

    // Simple name or attribute/subscript
    let target: ExpressionNode = { type: 'Name', id: this.expect('NAME').value }

    // Handle trailers (attributes and subscripts)
    while (true) {
      if (this.match('OP', '.')) {
        this.advance()
        const attr = this.expect('NAME').value
        target = { type: 'Attribute', value: target, attr }
      } else if (this.match('OP', '[')) {
        this.advance()
        const slice = this.parseSubscriptSlice()
        this.expect('OP', ']')
        target = { type: 'Subscript', value: target, slice }
      } else {
        break
      }
    }

    return target
  }

  private parseWhile(): WhileNode {
    this.advance() // consume 'while'
    const test = this.parseExpr()
    this.expect('OP', ':')
    const body = this.parseSuite()

    let orelse: StatementNode[] = []
    if (this.matchKeyword('else')) {
      this.advance()
      this.expect('OP', ':')
      orelse = this.parseSuite()
    }

    return { type: 'While', test, body, orelse }
  }

  private parseWith(isAsync = false): WithNode {
    this.advance() // consume 'with'
    const items: WithItemNode[] = []

    do {
      if (items.length > 0) {
        this.expect('OP', ',')
      }
      const contextExpr = this.parseExpr()
      let optionalVars: ExpressionNode | undefined
      if (this.matchKeyword('as')) {
        this.advance()
        optionalVars = this.parseExpr()
      }
      items.push({
        type: 'withitem',
        context_expr: contextExpr,
        optional_vars: optionalVars,
      })
    } while (this.match('OP', ','))

    this.expect('OP', ':')
    const body = this.parseSuite()

    return {
      type: isAsync ? 'AsyncWith' : 'With',
      items,
      body,
    }
  }

  private parseMatch(): MatchNode {
    this.advance() // consume 'match'
    const subject = this.parseExpr()
    this.expect('OP', ':')

    if (this.currentToken.type === 'NEWLINE') {
      this.advance()
    }
    this.expect('INDENT', '')

    const cases: MatchCaseNode[] = []
    while (this.matchKeyword('case')) {
      cases.push(this.parseMatchCase())
    }

    if (this.currentToken.type === 'DEDENT') {
      this.advance()
    }

    return { type: 'Match', subject, cases }
  }

  private parseMatchCase(): MatchCaseNode {
    this.advance() // consume 'case'
    const pattern = this.parsePattern()

    let guard: ExpressionNode | undefined
    if (this.matchKeyword('if')) {
      this.advance()
      guard = this.parseExpr()
    }

    this.expect('OP', ':')
    const body = this.parseSuite()

    return { type: 'match_case', pattern, guard, body }
  }

  private parsePattern(): PatternNode {
    return this.parseOrPattern()
  }

  private parseOrPattern(): PatternNode {
    let pattern = this.parseAsPattern()

    if (this.match('OP', '|')) {
      const patterns = [pattern]
      while (this.match('OP', '|')) {
        this.advance()
        patterns.push(this.parseAsPattern())
      }
      return { type: 'MatchOr', patterns }
    }

    return pattern
  }

  private parseAsPattern(): PatternNode {
    const pattern = this.parsePrimaryPattern()

    if (this.matchKeyword('as')) {
      this.advance()
      const name = this.expect('NAME').value
      return { type: 'MatchAs', pattern, name }
    }

    return pattern
  }

  private parsePrimaryPattern(): PatternNode {
    // Wildcard _
    if (this.match('NAME') && this.currentToken.value === '_') {
      this.advance()
      return { type: 'MatchAs' }
    }

    // Sequence pattern (a, b) or [a, b]
    if (this.match('OP', '(')) {
      this.advance()
      const patterns: PatternNode[] = []
      while (!this.match('OP', ')')) {
        if (patterns.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', ')')) break
        }
        patterns.push(this.parsePattern())
      }
      this.expect('OP', ')')
      return { type: 'MatchSequence', patterns }
    }

    if (this.match('OP', '[')) {
      this.advance()
      const patterns: PatternNode[] = []
      while (!this.match('OP', ']')) {
        if (patterns.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', ']')) break
        }
        patterns.push(this.parsePattern())
      }
      this.expect('OP', ']')
      return { type: 'MatchSequence', patterns }
    }

    // Mapping pattern {key: pattern}
    if (this.match('OP', '{')) {
      this.advance()
      const keys: ExpressionNode[] = []
      const patterns: PatternNode[] = []
      let rest: string | undefined

      while (!this.match('OP', '}')) {
        if (keys.length > 0) {
          this.expect('OP', ',')
          if (this.match('OP', '}')) break
        }

        if (this.match('OP', '**')) {
          this.advance()
          rest = this.expect('NAME').value
        } else {
          const key = this.parseExpr()
          this.expect('OP', ':')
          const pattern = this.parsePattern()
          keys.push(key)
          patterns.push(pattern)
        }
      }
      this.expect('OP', '}')
      return { type: 'MatchMapping', keys, patterns, rest }
    }

    // Class pattern or capture pattern
    if (this.match('NAME')) {
      const name = this.advance()

      // Check if this is a class pattern
      if (this.match('OP', '(')) {
        this.advance()
        const patterns: PatternNode[] = []
        const kwdAttrs: string[] = []
        const kwdPatterns: PatternNode[] = []

        while (!this.match('OP', ')')) {
          if (patterns.length > 0 || kwdAttrs.length > 0) {
            this.expect('OP', ',')
            if (this.match('OP', ')')) break
          }

          // Check for keyword pattern
          if (this.match('NAME') && this.tokenizer.peek().value === '=') {
            const attr = this.advance().value
            this.advance() // consume '='
            kwdAttrs.push(attr)
            kwdPatterns.push(this.parsePattern())
          } else {
            patterns.push(this.parsePattern())
          }
        }
        this.expect('OP', ')')

        return {
          type: 'MatchClass',
          cls: { type: 'Name', id: name.value },
          patterns,
          kwd_attrs: kwdAttrs,
          kwd_patterns: kwdPatterns,
        }
      }

      // Just a name - could be capture or value pattern
      // Check for dotted name (value pattern)
      if (this.match('OP', '.')) {
        let fullName: ExpressionNode = { type: 'Name', id: name.value }
        while (this.match('OP', '.')) {
          this.advance()
          const attr = this.expect('NAME').value
          fullName = { type: 'Attribute', value: fullName, attr }
        }
        return { type: 'MatchValue', value: fullName }
      }

      // Simple name - capture pattern
      return { type: 'MatchAs', name: name.value }
    }

    // Literal patterns
    if (this.match('NUMBER') || this.match('STRING')) {
      const value = this.parsePrimary()
      return { type: 'MatchValue', value }
    }

    // None, True, False
    if (this.matchKeyword('None')) {
      this.advance()
      return { type: 'MatchSingleton', value: null }
    }
    if (this.matchKeyword('True')) {
      this.advance()
      return { type: 'MatchSingleton', value: true }
    }
    if (this.matchKeyword('False')) {
      this.advance()
      return { type: 'MatchSingleton', value: false }
    }

    throw new SyntaxError(`Unexpected token in pattern: ${this.currentToken.value}`)
  }

  private parseTry(): TryNode {
    this.advance() // consume 'try'
    this.expect('OP', ':')
    const body = this.parseSuite()

    const handlers: ExceptHandlerNode[] = []
    let orelse: StatementNode[] = []
    let finalbody: StatementNode[] = []

    while (this.matchKeyword('except')) {
      handlers.push(this.parseExceptHandler())
    }

    if (this.matchKeyword('else')) {
      this.advance()
      this.expect('OP', ':')
      orelse = this.parseSuite()
    }

    if (this.matchKeyword('finally')) {
      this.advance()
      this.expect('OP', ':')
      finalbody = this.parseSuite()
    }

    return { type: 'Try', body, handlers, orelse, finalbody }
  }

  private parseExceptHandler(): ExceptHandlerNode {
    this.advance() // consume 'except'

    let type_: ExpressionNode | undefined
    let name: string | undefined

    if (!this.match('OP', ':')) {
      type_ = this.parseExpr()
      if (this.matchKeyword('as')) {
        this.advance()
        name = this.expect('NAME').value
      }
    }

    this.expect('OP', ':')
    const body = this.parseSuite()

    return { type: 'ExceptHandler', type_, name, body }
  }

  private parseReturn(): ReturnNode {
    this.advance() // consume 'return'
    let value: ExpressionNode | undefined
    if (!this.match('NEWLINE') && !this.match('ENDMARKER')) {
      value = this.parseExpr()
    }
    return { type: 'Return', value }
  }

  private parseRaise(): RaiseNode {
    this.advance() // consume 'raise'

    if (this.match('NEWLINE') || this.match('ENDMARKER')) {
      return { type: 'Raise' }
    }

    const exc = this.parseExpr()

    let cause: ExpressionNode | undefined
    if (this.matchKeyword('from')) {
      this.advance()
      cause = this.parseExpr()
    }

    return { type: 'Raise', exc, cause }
  }

  private parseGlobal(): GlobalNode {
    this.advance() // consume 'global'
    const names: string[] = []
    do {
      if (names.length > 0) this.expect('OP', ',')
      names.push(this.expect('NAME').value)
    } while (this.match('OP', ','))
    return { type: 'Global', names }
  }

  private parseNonlocal(): NonlocalNode {
    this.advance() // consume 'nonlocal'
    const names: string[] = []
    do {
      if (names.length > 0) this.expect('OP', ',')
      names.push(this.expect('NAME').value)
    } while (this.match('OP', ','))
    return { type: 'Nonlocal', names }
  }

  private parseAssert(): AssertNode {
    this.advance() // consume 'assert'
    const test = this.parseExpr()
    let msg: ExpressionNode | undefined
    if (this.match('OP', ',')) {
      this.advance()
      msg = this.parseExpr()
    }
    return { type: 'Assert', test, msg }
  }

  private parseDelete(): DeleteNode {
    this.advance() // consume 'del'
    const targets: ExpressionNode[] = []
    do {
      if (targets.length > 0) this.expect('OP', ',')
      targets.push(this.parseExpr())
    } while (this.match('OP', ','))
    return { type: 'Delete', targets }
  }

  private parseTypeAlias(): TypeAliasNode {
    this.advance() // consume 'type'
    const name: NameNode = { type: 'Name', id: this.expect('NAME').value }

    let typeParams: any[] = []
    if (this.match('OP', '[')) {
      typeParams = this.parseTypeParams()
    }

    this.expect('OP', '=')
    const value = this.parseExpr()

    return { type: 'TypeAlias', name, type_params: typeParams, value }
  }

  private parseExpressionStatement(): StatementNode {
    const expr = this.parseExprList()

    // Annotated assignment: x: int = 10
    if (this.match('OP', ':')) {
      this.advance()
      const annotation = this.parseExpr()
      let value: ExpressionNode | undefined
      if (this.match('OP', '=')) {
        this.advance()
        value = this.parseExpr()
      }
      return {
        type: 'AnnAssign',
        target: expr,
        annotation,
        value,
        simple: 1,
      }
    }

    // Augmented assignment
    const augOps: Record<string, OperatorType> = {
      '+=': 'Add',
      '-=': 'Sub',
      '*=': 'Mult',
      '/=': 'Div',
      '//=': 'FloorDiv',
      '%=': 'Mod',
      '**=': 'Pow',
      '&=': 'BitAnd',
      '|=': 'BitOr',
      '^=': 'BitXor',
      '>>=': 'RShift',
      '<<=': 'LShift',
      '@=': 'MatMult',
    }

    if (this.match('OP') && augOps[this.currentToken.value]) {
      const op = augOps[this.advance().value]
      const value = this.parseExpr()
      return { type: 'AugAssign', target: expr, op, value }
    }

    // Regular assignment (possibly chained)
    if (this.match('OP', '=')) {
      const targets: ExpressionNode[] = [expr]
      while (this.match('OP', '=')) {
        this.advance()
        targets.push(this.parseExprList())
      }
      const value = targets.pop()!
      return { type: 'Assign', targets, value }
    }

    // Expression statement
    return { type: 'Expr', value: expr }
  }

  private parseExprList(): ExpressionNode {
    const expr = this.parseExpr()

    if (this.match('OP', ',') && !this.isAssignTarget()) {
      const elts = [expr]
      while (this.match('OP', ',')) {
        this.advance()
        if (this.isEndOfExprList()) break
        elts.push(this.parseExpr())
      }
      return { type: 'Tuple', elts }
    }

    return expr
  }

  private isAssignTarget(): boolean {
    // Look ahead to see if this is followed by = or augmented assignment
    const next = this.tokenizer.peek()
    return next.value === '=' || next.value === ':' || next.value.endsWith('=')
  }

  private isEndOfExprList(): boolean {
    return (
      this.match('OP', ')') ||
      this.match('OP', ']') ||
      this.match('OP', '}') ||
      this.match('OP', ':') ||
      this.match('OP', '=') ||
      this.match('NEWLINE') ||
      this.match('ENDMARKER')
    )
  }

  private parseSuite(): StatementNode[] {
    if (this.currentToken.type === 'NEWLINE') {
      this.advance()
      this.expect('INDENT', '')

      const body: StatementNode[] = []
      while (!this.isAtSuiteEnd()) {
        const stmt = this.parseStatement()
        if (stmt) body.push(stmt)
      }

      if (this.match('DEDENT')) {
        this.advance()
      }

      return body
    }

    // Single-line suite
    const stmt = this.parseSimpleStatement()
    return stmt ? [stmt] : []
  }

  private isAtSuiteEnd(): boolean {
    return this.match('DEDENT') || this.match('ENDMARKER')
  }

  // ============== Expression Parsing ==============

  private parseExpr(): ExpressionNode {
    return this.parseNamedExpr()
  }

  private parseNamedExpr(): ExpressionNode {
    const expr = this.parseTernary()

    if (this.match('OP', ':=')) {
      this.advance()
      const value = this.parseExpr()
      return { type: 'NamedExpr', target: expr as NameNode, value }
    }

    return expr
  }

  private parseTernary(): ExpressionNode {
    const expr = this.parseOr()

    if (this.matchKeyword('if')) {
      this.advance()
      const test = this.parseOr()
      this.expect('NAME', 'else')
      const orelse = this.parseTernary()
      return { type: 'IfExp', test, body: expr, orelse }
    }

    return expr
  }

  private parseOr(): ExpressionNode {
    let left = this.parseAnd()

    if (this.matchKeyword('or')) {
      const values = [left]
      while (this.matchKeyword('or')) {
        this.advance()
        values.push(this.parseAnd())
      }
      return { type: 'BoolOp', op: 'Or', values }
    }

    return left
  }

  private parseAnd(): ExpressionNode {
    let left = this.parseNot()

    if (this.matchKeyword('and')) {
      const values = [left]
      while (this.matchKeyword('and')) {
        this.advance()
        values.push(this.parseNot())
      }
      return { type: 'BoolOp', op: 'And', values }
    }

    return left
  }

  private parseNot(): ExpressionNode {
    if (this.matchKeyword('not')) {
      this.advance()
      return { type: 'UnaryOp', op: 'Not', operand: this.parseNot() }
    }
    return this.parseComparison()
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseBitOr()

    const ops: CompareOperatorType[] = []
    const comparators: ExpressionNode[] = []

    while (true) {
      let op: CompareOperatorType | null = null

      if (this.match('OP', '<')) {
        this.advance()
        if (this.match('OP', '=')) {
          this.advance()
          op = 'LtE'
        } else {
          op = 'Lt'
        }
      } else if (this.match('OP', '>')) {
        this.advance()
        if (this.match('OP', '=')) {
          this.advance()
          op = 'GtE'
        } else {
          op = 'Gt'
        }
      } else if (this.match('OP', '==')) {
        this.advance()
        op = 'Eq'
      } else if (this.match('OP', '!=')) {
        this.advance()
        op = 'NotEq'
      } else if (this.match('OP', '<=')) {
        this.advance()
        op = 'LtE'
      } else if (this.match('OP', '>=')) {
        this.advance()
        op = 'GtE'
      } else if (this.matchKeyword('in')) {
        this.advance()
        op = 'In'
      } else if (this.matchKeyword('not')) {
        this.advance()
        this.expect('NAME', 'in')
        op = 'NotIn'
      } else if (this.matchKeyword('is')) {
        this.advance()
        if (this.matchKeyword('not')) {
          this.advance()
          op = 'IsNot'
        } else {
          op = 'Is'
        }
      }

      if (op === null) break

      ops.push(op)
      comparators.push(this.parseBitOr())
    }

    if (ops.length === 0) {
      return left
    }

    return { type: 'Compare', left, ops, comparators }
  }

  private parseBitOr(): ExpressionNode {
    let left = this.parseBitXor()

    while (this.match('OP', '|')) {
      this.advance()
      const right = this.parseBitXor()
      left = { type: 'BinOp', left, op: 'BitOr', right }
    }

    return left
  }

  private parseBitXor(): ExpressionNode {
    let left = this.parseBitAnd()

    while (this.match('OP', '^')) {
      this.advance()
      const right = this.parseBitAnd()
      left = { type: 'BinOp', left, op: 'BitXor', right }
    }

    return left
  }

  private parseBitAnd(): ExpressionNode {
    let left = this.parseShift()

    while (this.match('OP', '&')) {
      this.advance()
      const right = this.parseShift()
      left = { type: 'BinOp', left, op: 'BitAnd', right }
    }

    return left
  }

  private parseShift(): ExpressionNode {
    let left = this.parseArith()

    while (this.match('OP', '<<') || this.match('OP', '>>')) {
      const op: OperatorType = this.advance().value === '<<' ? 'LShift' : 'RShift'
      const right = this.parseArith()
      left = { type: 'BinOp', left, op, right }
    }

    return left
  }

  private parseArith(): ExpressionNode {
    let left = this.parseTerm()

    while (this.match('OP', '+') || this.match('OP', '-')) {
      const op: OperatorType = this.advance().value === '+' ? 'Add' : 'Sub'
      const right = this.parseTerm()
      left = { type: 'BinOp', left, op, right }
    }

    return left
  }

  private parseTerm(): ExpressionNode {
    let left = this.parseFactor()

    while (
      this.match('OP', '*') ||
      this.match('OP', '/') ||
      this.match('OP', '//') ||
      this.match('OP', '%') ||
      this.match('OP', '@')
    ) {
      const opVal = this.advance().value
      const op: OperatorType =
        opVal === '*' ? 'Mult' : opVal === '/' ? 'Div' : opVal === '//' ? 'FloorDiv' : opVal === '%' ? 'Mod' : 'MatMult'
      const right = this.parseFactor()
      left = { type: 'BinOp', left, op, right }
    }

    return left
  }

  private parseFactor(): ExpressionNode {
    if (this.match('OP', '+')) {
      this.advance()
      return { type: 'UnaryOp', op: 'UAdd', operand: this.parseFactor() }
    }
    if (this.match('OP', '-')) {
      this.advance()
      return { type: 'UnaryOp', op: 'USub', operand: this.parseFactor() }
    }
    if (this.match('OP', '~')) {
      this.advance()
      return { type: 'UnaryOp', op: 'Invert', operand: this.parseFactor() }
    }
    return this.parsePower()
  }

  private parsePower(): ExpressionNode {
    const left = this.parseAwait()

    if (this.match('OP', '**')) {
      this.advance()
      const right = this.parseFactor()
      return { type: 'BinOp', left, op: 'Pow', right }
    }

    return left
  }

  private parseAwait(): ExpressionNode {
    if (this.matchKeyword('await')) {
      this.advance()
      return { type: 'Await', value: this.parsePrimary() }
    }
    return this.parseAtom()
  }

  private parseAtom(): ExpressionNode {
    let atom = this.parsePrimary()

    // Handle trailers (calls, subscripts, attributes)
    while (true) {
      if (this.match('OP', '(')) {
        atom = this.parseCall(atom)
      } else if (this.match('OP', '[')) {
        atom = this.parseSubscript(atom)
      } else if (this.match('OP', '.')) {
        this.advance()
        const attr = this.expect('NAME').value
        atom = { type: 'Attribute', value: atom, attr }
      } else {
        break
      }
    }

    return atom
  }

  private parsePrimary(): ExpressionNode {
    // Lambda
    if (this.matchKeyword('lambda')) {
      return this.parseLambda()
    }

    // Yield
    if (this.matchKeyword('yield')) {
      this.advance()
      if (this.matchKeyword('from')) {
        this.advance()
        return { type: 'YieldFrom', value: this.parseExpr() }
      }
      if (!this.match('NEWLINE') && !this.match('OP', ')') && !this.match('OP', ',')) {
        return { type: 'Yield', value: this.parseExpr() }
      }
      return { type: 'Yield' }
    }

    // Parentheses, tuple, or generator expression
    if (this.match('OP', '(')) {
      this.advance()

      if (this.match('OP', ')')) {
        this.advance()
        return { type: 'Tuple', elts: [] }
      }

      const first = this.parseExpr()

      // Generator expression
      if (this.matchKeyword('for') || this.matchKeyword('async')) {
        const generators = this.parseComprehensionClauses()
        this.expect('OP', ')')
        return { type: 'GeneratorExp', elt: first, generators }
      }

      // Tuple or parenthesized expression
      if (this.match('OP', ',')) {
        const elts = [first]
        while (this.match('OP', ',')) {
          this.advance()
          if (this.match('OP', ')')) break
          elts.push(this.parseExpr())
        }
        this.expect('OP', ')')
        return { type: 'Tuple', elts }
      }

      this.expect('OP', ')')
      return first
    }

    // List or list comprehension
    if (this.match('OP', '[')) {
      this.advance()

      if (this.match('OP', ']')) {
        this.advance()
        return { type: 'List', elts: [] }
      }

      const first = this.parseExpr()

      // List comprehension
      if (this.matchKeyword('for') || this.matchKeyword('async')) {
        const generators = this.parseComprehensionClauses()
        this.expect('OP', ']')
        return { type: 'ListComp', elt: first, generators }
      }

      // Regular list
      const elts = [first]
      while (this.match('OP', ',')) {
        this.advance()
        if (this.match('OP', ']')) break
        elts.push(this.parseExpr())
      }
      this.expect('OP', ']')
      return { type: 'List', elts }
    }

    // Dict/set or comprehension
    if (this.match('OP', '{')) {
      return this.parseDictOrSet()
    }

    // Starred expression
    if (this.match('OP', '*')) {
      this.advance()
      return { type: 'Starred', value: this.parseExpr() }
    }

    // Name
    if (this.match('NAME')) {
      const name = this.advance().value
      // Special constants
      if (name === 'True') return { type: 'Constant', value: true }
      if (name === 'False') return { type: 'Constant', value: false }
      if (name === 'None') return { type: 'Constant', value: null }
      return { type: 'Name', id: name }
    }

    // Number
    if (this.match('NUMBER')) {
      const value = this.advance().value
      return { type: 'Constant', value: this.parseNumber(value) }
    }

    // String (including f-strings)
    if (this.match('STRING')) {
      return this.parseStringLiteral()
    }

    // Ellipsis
    if (this.match('OP', '...')) {
      this.advance()
      return { type: 'Constant', value: '...' }
    }

    throw new SyntaxError(`Unexpected token: ${this.currentToken.value}`)
  }

  private parseLambda(): LambdaNode {
    this.advance() // consume 'lambda'

    const args: ArgumentsNode = {
      type: 'arguments',
      posonlyargs: [],
      args: [],
      vararg: undefined,
      kwonlyargs: [],
      kw_defaults: [],
      kwarg: undefined,
      defaults: [],
    }

    // Parse lambda arguments
    if (!this.match('OP', ':')) {
      this.parseLambdaArgs(args)
    }

    this.expect('OP', ':')
    const body = this.parseExpr()

    return { type: 'Lambda', args, body }
  }

  private parseLambdaArgs(args: ArgumentsNode): void {
    let seenStar = false

    while (!this.match('OP', ':')) {
      if (args.args.length > 0 || args.kwonlyargs.length > 0 || args.vararg || args.kwarg) {
        if (!this.match('OP', ',')) break
        this.advance()
      }

      // **kwargs
      if (this.match('OP', '**')) {
        this.advance()
        args.kwarg = { type: 'arg', arg: this.expect('NAME').value }
        continue
      }

      // *args or bare *
      if (this.match('OP', '*')) {
        this.advance()
        seenStar = true
        if (this.match('NAME')) {
          args.vararg = { type: 'arg', arg: this.expect('NAME').value }
        }
        continue
      }

      // Regular argument
      const name = this.expect('NAME').value
      const arg: ArgNode = { type: 'arg', arg: name }

      if (this.match('OP', '=')) {
        this.advance()
        const defaultVal = this.parseExpr()
        if (seenStar) {
          args.kwonlyargs.push(arg)
          args.kw_defaults.push(defaultVal)
        } else {
          args.args.push(arg)
          args.defaults.push(defaultVal)
        }
      } else {
        if (seenStar) {
          args.kwonlyargs.push(arg)
          args.kw_defaults.push(null)
        } else {
          args.args.push(arg)
        }
      }
    }
  }

  private parseCall(func: ExpressionNode): CallNode {
    this.advance() // consume '('

    const args: ExpressionNode[] = []
    const keywords: KeywordNode[] = []

    while (!this.match('OP', ')')) {
      if (args.length > 0 || keywords.length > 0) {
        this.expect('OP', ',')
        if (this.match('OP', ')')) break
      }

      // **kwargs
      if (this.match('OP', '**')) {
        this.advance()
        keywords.push({ type: 'keyword', value: this.parseExpr() })
        continue
      }

      // *args
      if (this.match('OP', '*')) {
        this.advance()
        args.push({ type: 'Starred', value: this.parseExpr() })
        continue
      }

      // Check for keyword argument
      if (this.match('NAME') && this.tokenizer.peek().value === '=') {
        const name = this.advance().value
        this.advance() // consume '='
        keywords.push({ type: 'keyword', arg: name, value: this.parseExpr() })
        continue
      }

      args.push(this.parseExpr())
    }

    this.expect('OP', ')')
    return { type: 'Call', func, args, keywords }
  }

  private parseSubscript(value: ExpressionNode): SubscriptNode {
    this.advance() // consume '['

    const slice = this.parseSubscriptSlice()

    this.expect('OP', ']')
    return { type: 'Subscript', value, slice }
  }

  private parseSubscriptSlice(): ExpressionNode {
    // Handle slices, simple indices, and comma-separated indices (for generics)
    const first = this.parseSliceItem()

    // Check for comma-separated indices (Tuple for generics like Dict[str, int])
    if (this.match('OP', ',')) {
      const elts = [first]
      while (this.match('OP', ',')) {
        this.advance()
        if (this.match('OP', ']')) break
        elts.push(this.parseSliceItem())
      }
      return { type: 'Tuple', elts }
    }

    return first
  }

  private parseSliceItem(): ExpressionNode {
    // Handle a single slice or expression
    let lower: ExpressionNode | undefined
    let upper: ExpressionNode | undefined
    let step: ExpressionNode | undefined

    if (!this.match('OP', ':')) {
      lower = this.parseExpr()
    }

    // Check if this is a slice or just an index
    if (this.match('OP', ':')) {
      this.advance()

      if (!this.match('OP', ':') && !this.match('OP', ']') && !this.match('OP', ',')) {
        upper = this.parseExpr()
      }

      if (this.match('OP', ':')) {
        this.advance()
        if (!this.match('OP', ']') && !this.match('OP', ',')) {
          step = this.parseExpr()
        }
      }

      return { type: 'Slice', lower, upper, step }
    }

    // Just an index
    return lower!
  }

  private parseDictOrSet(): ExpressionNode {
    this.advance() // consume '{'

    if (this.match('OP', '}')) {
      this.advance()
      return { type: 'Dict', keys: [], values: [] }
    }

    // Check for ** spread
    if (this.match('OP', '**')) {
      this.advance()
      const firstValue = this.parseExpr()

      const keys: (ExpressionNode | null)[] = [null]
      const values: ExpressionNode[] = [firstValue]

      while (this.match('OP', ',')) {
        this.advance()
        if (this.match('OP', '}')) break

        if (this.match('OP', '**')) {
          this.advance()
          keys.push(null)
          values.push(this.parseExpr())
        } else {
          const key = this.parseExpr()
          this.expect('OP', ':')
          const value = this.parseExpr()
          keys.push(key)
          values.push(value)
        }
      }

      this.expect('OP', '}')
      return { type: 'Dict', keys, values }
    }

    const first = this.parseExpr()

    // Dict or dict comprehension
    if (this.match('OP', ':')) {
      this.advance()
      const firstValue = this.parseExpr()

      // Dict comprehension
      if (this.matchKeyword('for') || this.matchKeyword('async')) {
        const generators = this.parseComprehensionClauses()
        this.expect('OP', '}')
        return { type: 'DictComp', key: first, value: firstValue, generators }
      }

      // Regular dict
      const keys: (ExpressionNode | null)[] = [first]
      const values: ExpressionNode[] = [firstValue]

      while (this.match('OP', ',')) {
        this.advance()
        if (this.match('OP', '}')) break

        if (this.match('OP', '**')) {
          this.advance()
          keys.push(null)
          values.push(this.parseExpr())
        } else {
          const key = this.parseExpr()
          this.expect('OP', ':')
          const value = this.parseExpr()
          keys.push(key)
          values.push(value)
        }
      }

      this.expect('OP', '}')
      return { type: 'Dict', keys, values }
    }

    // Set comprehension
    if (this.matchKeyword('for') || this.matchKeyword('async')) {
      const generators = this.parseComprehensionClauses()
      this.expect('OP', '}')
      return { type: 'SetComp', elt: first, generators }
    }

    // Regular set
    const elts = [first]
    while (this.match('OP', ',')) {
      this.advance()
      if (this.match('OP', '}')) break
      elts.push(this.parseExpr())
    }

    this.expect('OP', '}')
    return { type: 'Set', elts }
  }

  private parseComprehensionClauses(): ComprehensionNode[] {
    const generators: ComprehensionNode[] = []

    while (this.matchKeyword('for') || this.matchKeyword('async')) {
      let isAsync = 0
      if (this.matchKeyword('async')) {
        isAsync = 1
        this.advance()
      }

      this.advance() // consume 'for'
      const target = this.parseTargetList()
      this.expect('NAME', 'in')
      const iter = this.parseOrTest() // Use parseOrTest to avoid 'if' issues

      const ifs: ExpressionNode[] = []
      while (this.matchKeyword('if')) {
        this.advance()
        ifs.push(this.parseOrTest()) // Use parseOrTest to avoid nested 'if' issues
      }

      generators.push({
        type: 'comprehension',
        target,
        iter,
        ifs,
        is_async: isAsync,
      })
    }

    return generators
  }

  // Parse or-test without ternary (for comprehension conditions)
  private parseOrTest(): ExpressionNode {
    let left = this.parseAndTest()

    if (this.matchKeyword('or')) {
      const values = [left]
      while (this.matchKeyword('or')) {
        this.advance()
        values.push(this.parseAndTest())
      }
      return { type: 'BoolOp', op: 'Or', values }
    }

    return left
  }

  private parseAndTest(): ExpressionNode {
    let left = this.parseNotTest()

    if (this.matchKeyword('and')) {
      const values = [left]
      while (this.matchKeyword('and')) {
        this.advance()
        values.push(this.parseNotTest())
      }
      return { type: 'BoolOp', op: 'And', values }
    }

    return left
  }

  private parseNotTest(): ExpressionNode {
    if (this.matchKeyword('not')) {
      this.advance()
      return { type: 'UnaryOp', op: 'Not', operand: this.parseNotTest() }
    }
    return this.parseComparison()
  }

  private parseNumber(value: string): number | bigint {
    // Remove underscores
    value = value.replace(/_/g, '')

    // Complex number
    if (value.endsWith('j') || value.endsWith('J')) {
      return parseFloat(value.slice(0, -1))
    }

    // Hex, octal, binary
    if (value.startsWith('0x') || value.startsWith('0X')) {
      return parseInt(value.slice(2), 16)
    }
    if (value.startsWith('0o') || value.startsWith('0O')) {
      return parseInt(value.slice(2), 8)
    }
    if (value.startsWith('0b') || value.startsWith('0B')) {
      return parseInt(value.slice(2), 2)
    }

    // Float
    if (value.includes('.') || value.includes('e') || value.includes('E')) {
      return parseFloat(value)
    }

    // Integer
    return parseInt(value, 10)
  }

  private parseStringLiteral(): ExpressionNode {
    const stringToken = this.advance()
    const raw = stringToken.value

    // Check for f-string
    if (raw.startsWith('f') || raw.startsWith('F') || raw.startsWith('rf') || raw.startsWith('fr') || raw.startsWith('RF') || raw.startsWith('FR') || raw.startsWith('Rf') || raw.startsWith('Fr') || raw.startsWith('rF') || raw.startsWith('fR')) {
      return this.parseFStringValue(raw)
    }

    // Concatenate adjacent strings
    let value = this.extractStringValue(raw)
    while (this.match('STRING')) {
      const nextRaw = this.advance().value
      if (nextRaw.startsWith('f') || nextRaw.startsWith('F')) {
        // Can't simply concatenate f-string with regular string
        // For now, just return the first string
        break
      }
      value += this.extractStringValue(nextRaw)
    }

    return { type: 'Constant', value }
  }

  private extractStringValue(raw: string): string {
    // Remove prefix
    let str = raw
    while (str[0] === 'r' || str[0] === 'R' || str[0] === 'b' || str[0] === 'B' || str[0] === 'u' || str[0] === 'U') {
      str = str.slice(1)
    }

    // Remove quotes
    if (str.startsWith('"""') || str.startsWith("'''")) {
      str = str.slice(3, -3)
    } else {
      str = str.slice(1, -1)
    }

    // Process escape sequences (simplified)
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
  }

  private parseFStringValue(raw: string): JoinedStrNode {
    // Extract the f-string content
    let str = raw

    // Remove prefix (f, F, rf, fr, etc.)
    while (/^[rfbuRFBU]/.test(str)) {
      str = str.slice(1)
    }

    // Determine quote style and remove quotes
    if (str.startsWith('"""') || str.startsWith("'''")) {
      str = str.slice(3, -3)
    } else {
      str = str.slice(1, -1)
    }

    const values: (ConstantNode | FormattedValueNode)[] = []
    let i = 0
    let textStart = 0

    while (i < str.length) {
      if (str[i] === '{') {
        if (str[i + 1] === '{') {
          // Escaped brace
          if (i > textStart) {
            values.push({ type: 'Constant', value: str.slice(textStart, i) + '{' })
          } else {
            values.push({ type: 'Constant', value: '{' })
          }
          i += 2
          textStart = i
          continue
        }

        // Add text before the expression
        if (i > textStart) {
          values.push({ type: 'Constant', value: str.slice(textStart, i) })
        }

        // Find matching }
        i++
        let braceDepth = 1
        let exprStart = i
        let conversion = -1
        let formatSpec: string | undefined

        let exprEnd = -1
        while (i < str.length && braceDepth > 0) {
          if (str[i] === '{') {
            braceDepth++
          } else if (str[i] === '}') {
            braceDepth--
          } else if (braceDepth === 1 && str[i] === '!') {
            exprEnd = i
            i++
            if (str[i] === 'r') conversion = 114
            else if (str[i] === 's') conversion = 115
            else if (str[i] === 'a') conversion = 97
            i++
            if (str[i] === ':') {
              i++
              const formatStart = i
              while (i < str.length && str[i] !== '}') i++
              formatSpec = str.slice(formatStart, i)
            }
            // Now skip the closing brace
            if (str[i] === '}') {
              braceDepth--
              i++
            }
            break
          } else if (braceDepth === 1 && str[i] === ':') {
            exprEnd = i
            i++
            const formatStart = i
            while (i < str.length && braceDepth > 0) {
              if (str[i] === '{') braceDepth++
              else if (str[i] === '}') braceDepth--
              if (braceDepth > 0) i++
            }
            formatSpec = str.slice(formatStart, i)
            i++ // skip }
            break
          }
          i++
        }

        // Build the formatted value
        if (exprEnd === -1) {
          exprEnd = i - 1 // expression ends just before the }
        }
        const exprStr = str.slice(exprStart, exprEnd).trim()
        if (exprStr) {
          const exprParser = new Parser(exprStr)
          const exprNode = exprParser.parseExpression()

          const formatted: FormattedValueNode = {
            type: 'FormattedValue',
            value: exprNode,
            conversion,
          }
          if (formatSpec) {
            formatted.format_spec = { type: 'JoinedStr', values: [{ type: 'Constant', value: formatSpec }] }
          }
          values.push(formatted)
        }
        textStart = i
      } else if (str[i] === '}' && str[i + 1] === '}') {
        // Escaped brace
        if (i > textStart) {
          values.push({ type: 'Constant', value: str.slice(textStart, i) + '}' })
        } else {
          values.push({ type: 'Constant', value: '}' })
        }
        i += 2
        textStart = i
      } else {
        i++
      }
    }

    // Add remaining text
    if (textStart < str.length) {
      values.push({ type: 'Constant', value: str.slice(textStart) })
    }

    // If empty f-string
    if (values.length === 0) {
      values.push({ type: 'Constant', value: '' })
    }

    return { type: 'JoinedStr', values }
  }
}

/**
 * Parse Python source code into an AST
 */
export function parse(source: string): ModuleNode {
  const parser = new Parser(source)
  return parser.parse()
}

/**
 * Parse a single Python expression
 */
export function parseExpression(source: string): ExpressionNode {
  const parser = new Parser(source)
  return parser.parseExpression()
}
