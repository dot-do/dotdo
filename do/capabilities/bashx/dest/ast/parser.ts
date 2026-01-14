/**
 * Bash AST Parser
 *
 * A lightweight parser for bash commands that detects common syntax errors.
 * Implements error detection for:
 * - Unclosed quotes (single and double)
 * - Missing terminators (fi, done, esac)
 * - Unbalanced brackets/braces
 * - Invalid pipe/redirect syntax
 */

import type { Program, ParseError, BashNode, Command, Word, Pipeline, List, Subshell, CompoundCommand, Redirect, Assignment } from '../types.js'

// ============================================================================
// Token Types
// ============================================================================

type TokenType =
  | 'WORD'
  | 'ASSIGNMENT'
  | 'PIPE'
  | 'AND'
  | 'OR'
  | 'SEMICOLON'
  | 'NEWLINE'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'DOUBLE_LBRACKET'
  | 'DOUBLE_RBRACKET'
  | 'REDIRECT_OUT'
  | 'REDIRECT_APPEND'
  | 'REDIRECT_IN'
  | 'REDIRECT_HEREDOC'
  | 'REDIRECT_HERESTRING'
  | 'BACKGROUND'
  | 'IF'
  | 'THEN'
  | 'ELSE'
  | 'ELIF'
  | 'FI'
  | 'FOR'
  | 'WHILE'
  | 'UNTIL'
  | 'DO'
  | 'DONE'
  | 'CASE'
  | 'ESAC'
  | 'IN'
  | 'CASE_PATTERN_END'
  | 'EOF'
  | 'ERROR'

interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

// ============================================================================
// Lexer
// ============================================================================

class Lexer {
  private input: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  errors: ParseError[] = []

  constructor(input: string) {
    this.input = input
  }

  private peek(offset: number = 0): string {
    return this.input[this.pos + offset] ?? ''
  }

  private advance(): string {
    const ch = this.input[this.pos] ?? ''
    this.pos++
    if (ch === '\n') {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return ch
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.peek()
      if (ch === ' ' || ch === '\t') {
        this.advance()
      } else if (ch === '\\' && this.peek(1) === '\n') {
        // Line continuation
        this.advance()
        this.advance()
      } else {
        break
      }
    }
  }

  private isWordChar(ch: string): boolean {
    // Not a special character
    return ch !== '' &&
      ch !== ' ' && ch !== '\t' && ch !== '\n' &&
      ch !== '|' && ch !== '&' && ch !== ';' &&
      ch !== '(' && ch !== ')' && ch !== '{' && ch !== '}' &&
      ch !== '<' && ch !== '>' && ch !== '#'
  }

  private readQuotedString(quote: string): string {
    const startLine = this.line
    const startColumn = this.column
    let result = quote
    this.advance() // consume opening quote

    while (this.pos < this.input.length) {
      const ch = this.peek()

      if (ch === quote) {
        result += this.advance()
        return result
      }

      if (ch === '\\' && quote === '"') {
        result += this.advance()
        if (this.pos < this.input.length) {
          result += this.advance()
        }
      } else if (ch === '$' && quote === '"') {
        // Handle parameter expansion and command/arithmetic substitution inside double quotes
        result += this.readParameterExpansion()
      } else {
        result += this.advance()
      }
    }

    // Unclosed quote
    const quoteType = quote === '"' ? 'double' : 'single'
    this.errors.push({
      message: `Unclosed ${quoteType} quote`,
      line: startLine,
      column: startColumn,
      suggestion: `Add closing ${quote} at the end`,
    })

    return result
  }

  private readParameterExpansion(): string {
    const startLine = this.line
    const startColumn = this.column
    let result = '$'
    this.advance() // consume $

    const next = this.peek()

    if (next === '(') {
      // Command substitution $(...) or arithmetic $((...))
      result += this.advance() // consume (

      if (this.peek() === '(') {
        // Arithmetic expansion $((
        result += this.advance() // consume second (
        let depth = 2
        let foundClosing = false

        while (this.pos < this.input.length) {
          const ch = this.peek()
          if (ch === '(') {
            depth++
            result += this.advance()
          } else if (ch === ')') {
            depth--
            result += this.advance()
            if (depth === 0) {
              foundClosing = true
              break
            }
          } else {
            result += this.advance()
          }
        }

        if (!foundClosing) {
          this.errors.push({
            message: 'Unclosed arithmetic expansion $((',
            line: startLine,
            column: startColumn,
            suggestion: 'Add closing )) at the end',
          })
        }
      } else {
        // Command substitution $(
        let depth = 1
        let foundClosing = false

        while (this.pos < this.input.length) {
          const ch = this.peek()
          if (ch === '"' || ch === "'") {
            result += this.readQuotedString(ch)
          } else if (ch === '(') {
            depth++
            result += this.advance()
          } else if (ch === ')') {
            depth--
            result += this.advance()
            if (depth === 0) {
              foundClosing = true
              break
            }
          } else {
            result += this.advance()
          }
        }

        if (!foundClosing) {
          this.errors.push({
            message: 'Unclosed command substitution $(',
            line: startLine,
            column: startColumn,
            suggestion: 'Add closing ) at the end',
          })
        }
      }
    } else if (next === '{') {
      // Parameter expansion ${...}
      result += this.advance() // consume {

      let depth = 1
      let foundClosing = false
      let hasUnclosedQuote = false

      while (this.pos < this.input.length) {
        const ch = this.peek()
        if (ch === '"' || ch === "'") {
          const quoteStart = this.pos
          const quotedStr = this.readQuotedStringInExpansion(ch)
          result += quotedStr
          // Check if quote was unclosed (doesn't end with the same quote char it started with)
          if (!quotedStr.endsWith(ch)) {
            hasUnclosedQuote = true
          }
        } else if (ch === '{') {
          depth++
          result += this.advance()
        } else if (ch === '}') {
          depth--
          result += this.advance()
          if (depth === 0) {
            foundClosing = true
            break
          }
        } else {
          result += this.advance()
        }
      }

      if (!foundClosing) {
        if (hasUnclosedQuote) {
          this.errors.push({
            message: 'Unclosed quote in parameter expansion',
            line: startLine,
            column: startColumn,
            suggestion: 'Add closing quote and } at the end',
          })
        } else {
          this.errors.push({
            message: 'Unclosed brace in parameter expansion ${',
            line: startLine,
            column: startColumn,
            suggestion: 'Add closing } at the end',
          })
        }
      }
    } else {
      // Simple variable $VAR
      while (this.pos < this.input.length) {
        const ch = this.peek()
        if (/[a-zA-Z0-9_]/.test(ch)) {
          result += this.advance()
        } else {
          break
        }
      }
    }

    return result
  }

  private readWord(): string {
    let result = ''

    while (this.pos < this.input.length) {
      const ch = this.peek()

      if (ch === '"' || ch === "'") {
        result += this.readQuotedString(ch)
      } else if (ch === '$') {
        result += this.readParameterExpansion()
      } else if (ch === '\\' && this.peek(1) !== '') {
        // Escape sequence
        result += this.advance()
        result += this.advance()
      } else if (ch === '`') {
        // Backtick command substitution
        const startLine = this.line
        const startColumn = this.column
        result += this.advance()
        let foundClosing = false
        while (this.pos < this.input.length) {
          const c = this.peek()
          if (c === '`') {
            result += this.advance()
            foundClosing = true
            break
          } else if (c === '\\') {
            result += this.advance()
            if (this.pos < this.input.length) {
              result += this.advance()
            }
          } else {
            result += this.advance()
          }
        }
        if (!foundClosing) {
          this.errors.push({
            message: 'Unclosed backtick command substitution',
            line: startLine,
            column: startColumn,
            suggestion: 'Add closing ` at the end',
          })
        }
      } else if (this.isWordChar(ch)) {
        result += this.advance()
      } else {
        break
      }
    }

    return result
  }

  nextToken(): Token {
    this.skipWhitespace()

    if (this.pos >= this.input.length) {
      return { type: 'EOF', value: '', line: this.line, column: this.column }
    }

    const startLine = this.line
    const startColumn = this.column
    const ch = this.peek()

    // Comments
    if (ch === '#') {
      while (this.pos < this.input.length && this.peek() !== '\n') {
        this.advance()
      }
      return this.nextToken()
    }

    // Newline
    if (ch === '\n') {
      this.advance()
      return { type: 'NEWLINE', value: '\n', line: startLine, column: startColumn }
    }

    // Semicolons and case pattern end
    if (ch === ';') {
      this.advance()
      if (this.peek() === ';') {
        this.advance()
        return { type: 'CASE_PATTERN_END', value: ';;', line: startLine, column: startColumn }
      }
      return { type: 'SEMICOLON', value: ';', line: startLine, column: startColumn }
    }

    // Pipes and logical operators
    if (ch === '|') {
      this.advance()
      if (this.peek() === '|') {
        this.advance()
        return { type: 'OR', value: '||', line: startLine, column: startColumn }
      }
      return { type: 'PIPE', value: '|', line: startLine, column: startColumn }
    }

    // And/background
    if (ch === '&') {
      this.advance()
      if (this.peek() === '&') {
        this.advance()
        return { type: 'AND', value: '&&', line: startLine, column: startColumn }
      }
      return { type: 'BACKGROUND', value: '&', line: startLine, column: startColumn }
    }

    // Parentheses
    if (ch === '(') {
      this.advance()
      return { type: 'LPAREN', value: '(', line: startLine, column: startColumn }
    }
    if (ch === ')') {
      this.advance()
      return { type: 'RPAREN', value: ')', line: startLine, column: startColumn }
    }

    // Braces
    if (ch === '{') {
      this.advance()
      return { type: 'LBRACE', value: '{', line: startLine, column: startColumn }
    }
    if (ch === '}') {
      this.advance()
      return { type: 'RBRACE', value: '}', line: startLine, column: startColumn }
    }

    // Brackets
    if (ch === '[') {
      this.advance()
      if (this.peek() === '[') {
        this.advance()
        return { type: 'DOUBLE_LBRACKET', value: '[[', line: startLine, column: startColumn }
      }
      return { type: 'LBRACKET', value: '[', line: startLine, column: startColumn }
    }
    if (ch === ']') {
      this.advance()
      if (this.peek() === ']') {
        this.advance()
        return { type: 'DOUBLE_RBRACKET', value: ']]', line: startLine, column: startColumn }
      }
      return { type: 'RBRACKET', value: ']', line: startLine, column: startColumn }
    }

    // Redirects
    if (ch === '>') {
      this.advance()
      if (this.peek() === '>') {
        this.advance()
        return { type: 'REDIRECT_APPEND', value: '>>', line: startLine, column: startColumn }
      }
      if (this.peek() === '&') {
        this.advance()
        return { type: 'REDIRECT_OUT', value: '>&', line: startLine, column: startColumn }
      }
      return { type: 'REDIRECT_OUT', value: '>', line: startLine, column: startColumn }
    }
    if (ch === '<') {
      this.advance()
      if (this.peek() === '<') {
        this.advance()
        if (this.peek() === '<') {
          this.advance()
          return { type: 'REDIRECT_HERESTRING', value: '<<<', line: startLine, column: startColumn }
        }
        return { type: 'REDIRECT_HEREDOC', value: '<<', line: startLine, column: startColumn }
      }
      if (this.peek() === '&') {
        this.advance()
        return { type: 'REDIRECT_IN', value: '<&', line: startLine, column: startColumn }
      }
      return { type: 'REDIRECT_IN', value: '<', line: startLine, column: startColumn }
    }

    // Words (including keywords)
    const word = this.readWord()
    if (word === '') {
      // Unknown character, try to recover
      const badChar = this.advance()
      this.errors.push({
        message: `Unexpected character '${badChar}'`,
        line: startLine,
        column: startColumn,
      })
      return { type: 'ERROR', value: badChar, line: startLine, column: startColumn }
    }

    // Check for keywords
    const keywords: Record<string, TokenType> = {
      if: 'IF',
      then: 'THEN',
      else: 'ELSE',
      elif: 'ELIF',
      fi: 'FI',
      for: 'FOR',
      while: 'WHILE',
      until: 'UNTIL',
      do: 'DO',
      done: 'DONE',
      case: 'CASE',
      esac: 'ESAC',
      in: 'IN',
    }

    const keywordType = keywords[word]
    if (keywordType) {
      return { type: keywordType, value: word, line: startLine, column: startColumn }
    }

    // Check for assignment (VAR=value)
    const assignMatch = word.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(=|\+=)(.*)$/)
    if (assignMatch) {
      return { type: 'ASSIGNMENT', value: word, line: startLine, column: startColumn }
    }

    return { type: 'WORD', value: word, line: startLine, column: startColumn }
  }

  tokenize(): Token[] {
    const tokens: Token[] = []
    let token: Token

    while ((token = this.nextToken()).type !== 'EOF') {
      if (token.type !== 'ERROR') {
        tokens.push(token)
      }
    }
    tokens.push(token) // Include EOF

    return tokens
  }
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
  private tokens: Token[]
  private pos: number = 0
  errors: ParseError[] = []

  constructor(tokens: Token[], lexerErrors: ParseError[]) {
    this.tokens = tokens
    this.errors = [...lexerErrors]
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset
    if (idx < 0 || idx >= this.tokens.length) {
      return { type: 'EOF', value: '', line: 0, column: 0 }
    }
    return this.tokens[idx]
  }

  private advance(): Token {
    const token = this.tokens[this.pos]
    if (this.pos < this.tokens.length) {
      this.pos++
    }
    return token
  }

  private expect(type: TokenType, message?: string): Token | null {
    const token = this.peek()
    if (token.type !== type) {
      if (message) {
        this.errors.push({
          message,
          line: token.line,
          column: token.column,
        })
      }
      return null
    }
    return this.advance()
  }

  private skipNewlines(): void {
    while (this.peek().type === 'NEWLINE') {
      this.advance()
    }
  }

  private isCommandTerminator(token: Token): boolean {
    return token.type === 'NEWLINE' ||
      token.type === 'SEMICOLON' ||
      token.type === 'PIPE' ||
      token.type === 'AND' ||
      token.type === 'OR' ||
      token.type === 'BACKGROUND' ||
      token.type === 'RPAREN' ||
      token.type === 'RBRACE' ||
      token.type === 'EOF'
  }

  private isRedirectToken(token: Token): boolean {
    return token.type === 'REDIRECT_OUT' ||
      token.type === 'REDIRECT_APPEND' ||
      token.type === 'REDIRECT_IN' ||
      token.type === 'REDIRECT_HEREDOC' ||
      token.type === 'REDIRECT_HERESTRING'
  }

  private parseRedirect(): Redirect | null {
    const token = this.peek()
    if (!this.isRedirectToken(token)) {
      return null
    }

    this.advance()
    this.skipWhitespaceTokens()

    const targetToken = this.peek()
    if (targetToken.type !== 'WORD' && targetToken.type !== 'ASSIGNMENT') {
      this.errors.push({
        message: `Redirect incomplete: missing file after ${token.value}`,
        line: token.line,
        column: token.column,
        suggestion: 'Specify a file name after the redirect operator',
      })
      return null
    }

    const target = this.advance()

    const opMap: Record<string, Redirect['op']> = {
      '>': '>',
      '>&': '>&',
      '>>': '>>',
      '<': '<',
      '<&': '<&',
      '<<': '<<',
      '<<<': '<<<',
    }

    return {
      type: 'Redirect',
      op: opMap[token.value] ?? '>',
      target: { type: 'Word', value: target.value },
    }
  }

  private skipWhitespaceTokens(): void {
    // No explicit whitespace tokens in our lexer, but keep for consistency
  }

  private parseWord(): Word | null {
    const token = this.peek()
    if (token.type === 'WORD' || token.type === 'ASSIGNMENT') {
      this.advance()
      let quoted: Word['quoted'] = undefined

      // Check if quoted
      if (token.value.startsWith('"') || token.value.includes('"')) {
        quoted = 'double'
      } else if (token.value.startsWith("'") || token.value.includes("'")) {
        quoted = 'single'
      }

      return {
        type: 'Word',
        value: token.value,
        quoted,
      }
    }
    return null
  }

  private parseSimpleCommand(): Command | null {
    const prefix: Assignment[] = []
    const args: Word[] = []
    const redirects: Redirect[] = []
    let name: Word | null = null

    // Parse assignments at the start
    while (this.peek().type === 'ASSIGNMENT') {
      const token = this.advance()
      const match = token.value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(=|\+=)(.*)$/)
      if (match) {
        prefix.push({
          type: 'Assignment',
          name: match[1],
          operator: match[2] as '=' | '+=',
          value: match[3] ? { type: 'Word', value: match[3] } : null,
        })
      }
    }

    // Handle single [ test command
    if (this.peek().type === 'LBRACKET') {
      const startToken = this.advance()
      name = { type: 'Word', value: '[' }

      // Parse test expression arguments until ]
      while (this.peek().type !== 'RBRACKET' && this.peek().type !== 'EOF' &&
        !this.isCommandTerminator(this.peek())) {
        const token = this.peek()
        if (token.type === 'WORD') {
          const word = this.parseWord()
          if (word) {
            args.push(word)
          }
        } else {
          break
        }
      }

      // Expect closing ]
      if (this.peek().type !== 'RBRACKET') {
        this.errors.push({
          message: 'Unclosed [ test bracket: missing ]',
          line: startToken.line,
          column: startToken.column,
          suggestion: 'Add ] to close the test bracket',
        })
      } else {
        this.advance() // consume ]
        args.push({ type: 'Word', value: ']' })
      }

      return { type: 'Command', name, prefix, args, redirects }
    }

    // Parse command name and arguments
    while (true) {
      const token = this.peek()

      if (this.isRedirectToken(token)) {
        // Check for consecutive redirects (like > >)
        const prevToken = this.peek(-1)
        if (prevToken && this.isRedirectToken(prevToken)) {
          this.errors.push({
            message: `Consecutive redirects: unexpected ${token.value} after ${prevToken.value}`,
            line: token.line,
            column: token.column,
            suggestion: 'Remove one of the redirect operators',
          })
        }
        const redirect = this.parseRedirect()
        if (redirect) {
          redirects.push(redirect)
        }
      } else if (token.type === 'WORD') {
        const word = this.parseWord()
        if (word) {
          if (!name) {
            name = word
          } else {
            args.push(word)
          }
        }
      } else if (this.isCommandTerminator(token) || token.type === 'THEN' || token.type === 'DO' ||
        token.type === 'ELSE' || token.type === 'ELIF' || token.type === 'FI' ||
        token.type === 'DONE' || token.type === 'ESAC' || token.type === 'CASE_PATTERN_END') {
        break
      } else {
        break
      }
    }

    if (!name && prefix.length === 0 && redirects.length === 0) {
      return null
    }

    return {
      type: 'Command',
      name,
      prefix,
      args,
      redirects,
    }
  }

  private parseSubshell(): Subshell | null {
    if (this.peek().type !== 'LPAREN') {
      return null
    }

    const startToken = this.advance() // consume (
    this.skipNewlines()

    const body: BashNode[] = []

    while (this.peek().type !== 'RPAREN' && this.peek().type !== 'EOF') {
      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      }
      this.skipNewlines()

      if (this.peek().type === 'SEMICOLON') {
        this.advance()
        this.skipNewlines()
      }
    }

    if (this.peek().type !== 'RPAREN') {
      this.errors.push({
        message: 'Unclosed subshell: missing )',
        line: startToken.line,
        column: startToken.column,
        suggestion: 'Add ) to close the subshell',
      })
      return { type: 'Subshell', body }
    }

    this.advance() // consume )

    return { type: 'Subshell', body }
  }

  private parseBraceGroup(): CompoundCommand | null {
    if (this.peek().type !== 'LBRACE') {
      return null
    }

    const startToken = this.advance() // consume {
    this.skipNewlines()

    const body: BashNode[] = []

    while (this.peek().type !== 'RBRACE' && this.peek().type !== 'EOF') {
      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      }
      this.skipNewlines()

      if (this.peek().type === 'SEMICOLON') {
        this.advance()
        this.skipNewlines()
      }
    }

    if (this.peek().type !== 'RBRACE') {
      this.errors.push({
        message: 'Unclosed brace group: missing }',
        line: startToken.line,
        column: startToken.column,
        suggestion: 'Add } to close the brace group',
      })
      return { type: 'CompoundCommand', kind: 'brace', body }
    }

    this.advance() // consume }

    return { type: 'CompoundCommand', kind: 'brace', body }
  }

  private parseIfStatement(): CompoundCommand | null {
    if (this.peek().type !== 'IF') {
      return null
    }

    const startToken = this.advance() // consume 'if'
    this.skipNewlines()

    const body: BashNode[] = []

    // Parse condition
    const condition = this.parseCompoundList()
    if (condition) {
      body.push(condition)
    }

    this.skipNewlines()

    // Expect 'then'
    if (this.peek().type !== 'THEN') {
      this.errors.push({
        message: "Missing 'then' in if statement",
        line: this.peek().line,
        column: this.peek().column,
        suggestion: "Add 'then' after the condition",
      })
    } else {
      this.advance()
    }

    this.skipNewlines()

    // Parse 'then' body
    while (this.peek().type !== 'ELSE' && this.peek().type !== 'ELIF' &&
      this.peek().type !== 'FI' && this.peek().type !== 'EOF') {
      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      } else {
        break
      }
      this.skipNewlines()
      if (this.peek().type === 'SEMICOLON') {
        this.advance()
        this.skipNewlines()
      }
    }

    // Parse 'elif' or 'else'
    while (this.peek().type === 'ELIF' || this.peek().type === 'ELSE') {
      this.advance()
      this.skipNewlines()

      if (this.peek(-1).type === 'ELIF') {
        // Parse elif condition
        const elifCondition = this.parseCompoundList()
        if (elifCondition) {
          body.push(elifCondition)
        }
        this.skipNewlines()
        if (this.peek().type === 'THEN') {
          this.advance()
        }
        this.skipNewlines()
      }

      // Parse else/elif body
      while (this.peek().type !== 'ELSE' && this.peek().type !== 'ELIF' &&
        this.peek().type !== 'FI' && this.peek().type !== 'EOF') {
        const node = this.parseCompoundList()
        if (node) {
          body.push(node)
        } else {
          break
        }
        this.skipNewlines()
        if (this.peek().type === 'SEMICOLON') {
          this.advance()
          this.skipNewlines()
        }
      }
    }

    // Expect 'fi'
    if (this.peek().type !== 'FI') {
      this.errors.push({
        message: "Missing 'fi' to close if statement",
        line: startToken.line,
        column: startToken.column,
        suggestion: "Add 'fi' at the end",
      })
    } else {
      this.advance()
    }

    return { type: 'CompoundCommand', kind: 'if', body }
  }

  private parseForLoop(): CompoundCommand | null {
    if (this.peek().type !== 'FOR') {
      return null
    }

    const startToken = this.advance() // consume 'for'
    this.skipNewlines()

    const body: BashNode[] = []

    // Parse variable name
    if (this.peek().type === 'WORD') {
      body.push({ type: 'Command', name: this.parseWord(), prefix: [], args: [], redirects: [] })
    }

    this.skipNewlines()

    // Expect 'in' (optional)
    if (this.peek().type === 'IN') {
      this.advance()
      this.skipNewlines()

      // Parse word list
      while (this.peek().type === 'WORD') {
        body.push({ type: 'Command', name: this.parseWord(), prefix: [], args: [], redirects: [] })
      }
    }

    this.skipNewlines()

    // Allow semicolon before do
    if (this.peek().type === 'SEMICOLON') {
      this.advance()
      this.skipNewlines()
    }

    // Expect 'do'
    if (this.peek().type !== 'DO') {
      this.errors.push({
        message: "Missing 'do' in for loop",
        line: this.peek().line,
        column: this.peek().column,
        suggestion: "Add 'do' before the loop body",
      })
    } else {
      this.advance()
    }

    this.skipNewlines()

    // Parse loop body
    while (this.peek().type !== 'DONE' && this.peek().type !== 'EOF') {
      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      } else {
        break
      }
      this.skipNewlines()
      if (this.peek().type === 'SEMICOLON') {
        this.advance()
        this.skipNewlines()
      }
    }

    // Expect 'done'
    if (this.peek().type !== 'DONE') {
      this.errors.push({
        message: "Missing 'done' to close for loop",
        line: startToken.line,
        column: startToken.column,
        suggestion: "Add 'done' at the end",
      })
    } else {
      this.advance()
    }

    return { type: 'CompoundCommand', kind: 'for', body }
  }

  private parseWhileLoop(): CompoundCommand | null {
    const tokenType = this.peek().type
    if (tokenType !== 'WHILE' && tokenType !== 'UNTIL') {
      return null
    }

    const startToken = this.advance() // consume 'while' or 'until'
    const kind = tokenType === 'WHILE' ? 'while' : 'until'
    this.skipNewlines()

    const body: BashNode[] = []

    // Parse condition
    const condition = this.parseCompoundList()
    if (condition) {
      body.push(condition)
    }

    this.skipNewlines()

    // Allow semicolon before do
    if (this.peek().type === 'SEMICOLON') {
      this.advance()
      this.skipNewlines()
    }

    // Expect 'do'
    if (this.peek().type !== 'DO') {
      this.errors.push({
        message: `Missing 'do' in ${kind} loop`,
        line: this.peek().line,
        column: this.peek().column,
        suggestion: "Add 'do' before the loop body",
      })
    } else {
      this.advance()
    }

    this.skipNewlines()

    // Parse loop body
    while (this.peek().type !== 'DONE' && this.peek().type !== 'EOF') {
      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      } else {
        break
      }
      this.skipNewlines()
      if (this.peek().type === 'SEMICOLON') {
        this.advance()
        this.skipNewlines()
      }
    }

    // Expect 'done'
    if (this.peek().type !== 'DONE') {
      this.errors.push({
        message: `Missing 'done' to close ${kind} loop`,
        line: startToken.line,
        column: startToken.column,
        suggestion: "Add 'done' at the end",
      })
    } else {
      this.advance()
    }

    return { type: 'CompoundCommand', kind, body }
  }

  private parseCaseStatement(): CompoundCommand | null {
    if (this.peek().type !== 'CASE') {
      return null
    }

    const startToken = this.advance() // consume 'case'
    this.skipNewlines()

    const body: BashNode[] = []

    // Parse word
    if (this.peek().type === 'WORD') {
      body.push({ type: 'Command', name: this.parseWord(), prefix: [], args: [], redirects: [] })
    }

    this.skipNewlines()

    // Expect 'in'
    if (this.peek().type === 'IN') {
      this.advance()
    }

    this.skipNewlines()

    // Parse case items
    while (this.peek().type !== 'ESAC' && this.peek().type !== 'EOF') {
      // Parse pattern
      if (this.peek().type === 'WORD' || this.peek().type === 'LPAREN') {
        // Skip optional (
        if (this.peek().type === 'LPAREN') {
          this.advance()
        }

        // Parse pattern word(s)
        while (this.peek().type === 'WORD') {
          this.advance()
          if (this.peek().type === 'PIPE') {
            this.advance() // pattern separator
          } else {
            break
          }
        }

        // Expect )
        if (this.peek().type === 'RPAREN') {
          this.advance()
        }

        this.skipNewlines()

        // Parse case body until ;;
        while (this.peek().type !== 'CASE_PATTERN_END' &&
          this.peek().type !== 'ESAC' &&
          this.peek().type !== 'EOF') {
          const node = this.parseCompoundList()
          if (node) {
            body.push(node)
          } else {
            break
          }
          this.skipNewlines()
          if (this.peek().type === 'SEMICOLON') {
            this.advance()
            this.skipNewlines()
          }
        }

        // Consume ;;
        if (this.peek().type === 'CASE_PATTERN_END') {
          this.advance()
        }

        this.skipNewlines()
      } else {
        break
      }
    }

    // Expect 'esac'
    if (this.peek().type !== 'ESAC') {
      this.errors.push({
        message: "Missing 'esac' to close case statement",
        line: startToken.line,
        column: startToken.column,
        suggestion: "Add 'esac' at the end",
      })
    } else {
      this.advance()
    }

    return { type: 'CompoundCommand', kind: 'case', body }
  }

  private parseTestCommand(): CompoundCommand | null {
    const token = this.peek()

    // [[ test ]]
    if (token.type === 'DOUBLE_LBRACKET') {
      const startToken = this.advance()
      const body: BashNode[] = []

      // Parse test expression
      while (this.peek().type !== 'DOUBLE_RBRACKET' && this.peek().type !== 'EOF') {
        const word = this.parseWord()
        if (word) {
          body.push({ type: 'Command', name: word, prefix: [], args: [], redirects: [] })
        } else {
          break
        }
      }

      if (this.peek().type !== 'DOUBLE_RBRACKET') {
        this.errors.push({
          message: 'Unclosed [[ test: missing ]]',
          line: startToken.line,
          column: startToken.column,
          suggestion: 'Add ]] to close the test',
        })
      } else {
        this.advance()
      }

      return { type: 'CompoundCommand', kind: 'arithmetic', body }
    }

    // [ test ] - this is handled as a regular command
    return null
  }

  private parseCompoundCommand(): BashNode | null {
    const token = this.peek()

    switch (token.type) {
      case 'IF':
        return this.parseIfStatement()
      case 'FOR':
        return this.parseForLoop()
      case 'WHILE':
      case 'UNTIL':
        return this.parseWhileLoop()
      case 'CASE':
        return this.parseCaseStatement()
      case 'LPAREN':
        return this.parseSubshell()
      case 'LBRACE':
        return this.parseBraceGroup()
      case 'DOUBLE_LBRACKET':
        return this.parseTestCommand()
      default:
        return null
    }
  }

  private parsePipeline(): BashNode | null {
    const commands: Command[] = []

    // Check for leading pipe (error)
    if (this.peek().type === 'PIPE') {
      this.errors.push({
        message: 'Pipe at start of command: command expected before |',
        line: this.peek().line,
        column: this.peek().column,
        suggestion: 'Add a command before the pipe',
      })
      this.advance() // consume the pipe and continue
    }

    // Try compound command first
    const compound = this.parseCompoundCommand()
    if (compound) {
      // Check for pipe after compound
      this.skipNewlines()
      if (this.peek().type === 'PIPE') {
        // Compound commands in pipelines - for now, return as-is
        return compound
      }
      return compound
    }

    // Parse first simple command
    const firstCmd = this.parseSimpleCommand()
    if (!firstCmd) {
      return null
    }
    commands.push(firstCmd)

    // Parse pipeline continuation
    while (this.peek().type === 'PIPE') {
      const pipeToken = this.advance()

      // Check for consecutive pipes
      if (this.peek().type === 'PIPE') {
        this.errors.push({
          message: 'Consecutive pipes: remove extra |',
          line: this.peek().line,
          column: this.peek().column,
          suggestion: 'Remove one of the consecutive pipes',
        })
        this.advance() // consume extra pipe
      }

      this.skipNewlines()

      // Check for missing command after pipe
      if (this.isCommandTerminator(this.peek()) || this.peek().type === 'EOF') {
        this.errors.push({
          message: 'Pipe incomplete: missing command after |',
          line: pipeToken.line,
          column: pipeToken.column,
          suggestion: 'Add a command after the pipe',
        })
        break
      }

      const nextCmd = this.parseSimpleCommand()
      if (nextCmd) {
        commands.push(nextCmd)
      } else {
        break
      }
    }

    if (commands.length === 1) {
      return commands[0]
    }

    return {
      type: 'Pipeline',
      negated: false,
      commands,
    }
  }

  private parseAndOr(): BashNode | null {
    let left = this.parsePipeline()
    if (!left) {
      return null
    }

    while (this.peek().type === 'AND' || this.peek().type === 'OR') {
      const opToken = this.advance()
      const operator = opToken.type === 'AND' ? '&&' : '||'

      this.skipNewlines()

      // Check for missing command after && or ||
      if (this.isCommandTerminator(this.peek()) || this.peek().type === 'EOF') {
        this.errors.push({
          message: `Incomplete ${operator === '&&' ? 'AND' : 'OR'} list: missing command after ${operator}`,
          line: opToken.line,
          column: opToken.column,
          suggestion: `Add a command after ${operator}`,
        })
        return left
      }

      const right = this.parsePipeline()
      if (!right) {
        return left
      }

      left = {
        type: 'List',
        operator,
        left,
        right,
      } as List
    }

    return left
  }

  private parseCompoundList(): BashNode | null {
    this.skipNewlines()

    // Check for unexpected token at start
    if (this.peek().type === 'SEMICOLON') {
      const token = this.peek()
      this.errors.push({
        message: 'Unexpected semicolon at start of command',
        line: token.line,
        column: token.column,
        suggestion: 'Remove the leading semicolon',
      })
      this.advance()
      this.skipNewlines()
    }

    return this.parseAndOr()
  }

  parse(): Program {
    const body: BashNode[] = []

    while (this.peek().type !== 'EOF') {
      this.skipNewlines()

      if (this.peek().type === 'EOF') {
        break
      }

      const node = this.parseCompoundList()
      if (node) {
        body.push(node)
      }

      // Consume terminators
      const nextToken = this.peek()
      if (nextToken.type === 'SEMICOLON' || nextToken.type === 'NEWLINE' || nextToken.type === 'BACKGROUND') {
        this.advance()
      } else if (nextToken.type !== 'EOF' && !node) {
        // Stuck, skip token to avoid infinite loop
        this.advance()
      }
    }

    return {
      type: 'Program',
      body,
      errors: this.errors.length > 0 ? this.errors : undefined,
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a bash command string into an AST
 *
 * @example
 * ```typescript
 * const ast = parse('ls -la | grep foo')
 * // Returns Program with Pipeline containing two Commands
 * ```
 */
export function parse(input: string): Program {
  // Handle empty or whitespace-only input
  const trimmed = input.trim()
  if (trimmed === '') {
    return {
      type: 'Program',
      body: [],
      errors: undefined,
    }
  }

  const lexer = new Lexer(input)
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens, lexer.errors)

  return parser.parse()
}

/**
 * Check if input is syntactically valid bash
 */
export function isValidSyntax(input: string): boolean {
  const ast = parse(input)
  return !ast.errors || ast.errors.length === 0
}
