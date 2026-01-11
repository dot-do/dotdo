/**
 * SDL Parser - Gel Schema Definition Language Parser
 *
 * Hand-rolled recursive descent parser for EdgeDB/Gel SDL.
 * Parses SDL into a Schema intermediate representation (IR).
 *
 * @see spike-parser-findings.md for rationale on hand-rolled approach
 */

import { tokenize, TokenType } from './lexer'
import type { Token } from './lexer'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SchemaLocation {
  line: number
  column: number
}

export interface PropertyConstraint {
  type: string
  value?: number
  pattern?: string
  values?: string[]
  on?: string[]
  expr?: string
  delegated?: boolean
}

export interface PropertyAnnotations {
  title?: string
  description?: string
  [key: string]: string | undefined
}

export interface RewriteRule {
  trigger: 'insert' | 'update'
  expression: string
}

export interface Property {
  name: string
  type: string
  required: boolean
  optional?: boolean
  readonly: boolean
  overloaded?: boolean
  default?: string | number | boolean
  defaultExpr?: string
  constraints: PropertyConstraint[]
  annotations?: PropertyAnnotations
  elementType?: string
  tupleTypes?: string[]
  tupleFields?: Record<string, string>
  rewrites?: RewriteRule[]
  location?: SchemaLocation
}

export interface LinkProperty {
  name: string
  type: string
  required: boolean
  default?: string | number | boolean
}

export interface Link {
  name: string
  target: string
  required: boolean
  cardinality: 'single' | 'multi'
  overloaded?: boolean
  properties?: LinkProperty[]
  constraints?: PropertyConstraint[]
  onTargetDelete?: string
  location?: SchemaLocation
}

export interface Backlink {
  name: string
  forwardLink: string
  targetType: string | string[]
  cardinality: 'single' | 'multi'
  expression?: string
  properties?: undefined
  location?: SchemaLocation
}

export interface ComputedProperty {
  name: string
  expression: string
  returnType?: string
  cardinality?: 'single' | 'multi'
  location?: SchemaLocation
}

export interface Index {
  on: string[]
  expression?: string
  using?: string
  deferred?: boolean
  annotations?: Record<string, string>
  location?: SchemaLocation
}

export interface Trigger {
  name: string
  timing: 'before' | 'after'
  event: string
  condition?: string
  action: string
  location?: SchemaLocation
}

export interface AccessPolicy {
  name: string
  allow: string[]
  condition: string
  location?: SchemaLocation
}

export interface TypeDefinition {
  name: string
  module?: string
  abstract: boolean
  extends: string[]
  properties: Property[]
  links: Link[]
  backlinks: Backlink[]
  computedProperties: ComputedProperty[]
  constraints: PropertyConstraint[]
  indexes: Index[]
  triggers?: Trigger[]
  accessPolicies?: AccessPolicy[]
  annotations?: Record<string, string>
  doc?: string
  raw?: string
  location?: SchemaLocation
}

export interface EnumDefinition {
  name: string
  values: string[]
  location?: SchemaLocation
}

export interface Module {
  name: string
  types: TypeDefinition[]
  enums: EnumDefinition[]
  location?: SchemaLocation
}

export interface GlobalDefinition {
  name: string
  type: string
  required?: boolean
  default?: string | number | boolean
  location?: SchemaLocation
}

export interface AliasDefinition {
  name: string
  expression: string
  location?: SchemaLocation
}

export interface FunctionDefinition {
  name: string
  parameters: Array<{ name: string; type: string }>
  returnType: string
  body: string
  location?: SchemaLocation
}

export interface ScalarDefinition {
  name: string
  extends: string
  constraints: PropertyConstraint[]
  location?: SchemaLocation
}

export interface Schema {
  types: TypeDefinition[]
  enums: EnumDefinition[]
  modules: Module[]
  aliases: AliasDefinition[]
  globals: GlobalDefinition[]
  functions: FunctionDefinition[]
  scalars: ScalarDefinition[]
  extensions: string[]
}

// ============================================================================
// PARSER ERROR
// ============================================================================

class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number
  ) {
    super(`Parse error at line ${line}, column ${column}: ${message}`)
    this.name = 'ParseError'
  }
}

// ============================================================================
// PRIMITIVE TYPES SET
// ============================================================================

const PRIMITIVE_TYPES = new Set([
  'str',
  'bool',
  'uuid',
  'int16',
  'int32',
  'int64',
  'float32',
  'float64',
  'bigint',
  'decimal',
  'datetime',
  'duration',
  'json',
  'bytes',
  'cal::local_date',
  'cal::local_time',
  'cal::local_datetime',
  'cal::relative_duration',
  'cal::date_duration',
])

// Only SDL structural keywords that cannot be used as type names
// EdgeQL keywords like 'select', 'order', 'insert' ARE valid as type names
const RESERVED_KEYWORDS = new Set([
  'type',
  'abstract',
  'scalar',
  'module',
  'constraint',
  'index',
  'required',
  'optional',
  'multi',
  'single',
  'link',
  'property',
  'extending',
  'enum',
  'function',
  'alias',
  'global',
  'using',
  'annotation',
  'trigger',
  'access',
  'policy',
  'true',
  'false',
  'like',
  'ilike',
])

// ============================================================================
// SDL PARSER CLASS
// ============================================================================

class SDLParser {
  private tokens: Token[] = []
  private pos: number = 0
  private source: string = ''
  private currentDocComment: string | undefined = undefined
  private knownEnums: Set<string> = new Set()

  constructor(source: string) {
    this.source = source
    // Tokenize with comments preserved for doc comments
    this.tokens = tokenize(source, { preserveComments: true })
  }

  parse(): Schema {
    const schema: Schema = {
      types: [],
      enums: [],
      modules: [],
      aliases: [],
      globals: [],
      functions: [],
      scalars: [],
      extensions: [],
    }

    while (!this.isAtEnd()) {
      this.skipCommentsAndWhitespace()
      if (this.isAtEnd()) break

      const decl = this.parseDeclaration(schema)
      if (decl) {
        if ('values' in decl && 'name' in decl && !('properties' in decl)) {
          schema.enums.push(decl as EnumDefinition)
        } else if ('types' in decl && 'enums' in decl) {
          schema.modules.push(decl as Module)
        } else if ('expression' in decl && 'name' in decl && !('parameters' in decl) && !('forwardLink' in decl) && !('returnType' in decl || 'cardinality' in decl)) {
          schema.aliases.push(decl as AliasDefinition)
        } else if ('parameters' in decl) {
          schema.functions.push(decl as FunctionDefinition)
        } else if ('extends' in decl && 'constraints' in decl && !('properties' in decl)) {
          schema.scalars.push(decl as ScalarDefinition)
        } else if ('properties' in decl) {
          const typeDef = decl as TypeDefinition
          typeDef.module = 'default'
          schema.types.push(typeDef)
        }
      }
    }

    return schema
  }

  private skipCommentsAndWhitespace(): void {
    while (!this.isAtEnd()) {
      const token = this.peek()
      if (token.type === TokenType.COMMENT) {
        // Check for doc comment (starts with ##)
        if (token.value.startsWith('##')) {
          this.currentDocComment = token.value.slice(2).trim()
        }
        this.advance()
      } else {
        break
      }
    }
  }

  private parseDeclaration(schema: Schema): TypeDefinition | EnumDefinition | Module | AliasDefinition | GlobalDefinition | FunctionDefinition | ScalarDefinition | null {
    this.skipCommentsAndWhitespace()
    if (this.isAtEnd()) return null

    const token = this.peek()

    // using extension
    if (this.matchIdentifier('using')) {
      return this.parseUsing(schema)
    }

    // global declaration
    if (this.checkIdentifier('global')) {
      this.advance()
      return this.parseGlobal(schema, false)
    }

    // required global declaration
    if (this.checkIdentifier('required') && this.peekIdentifier('global')) {
      this.advance() // consume 'required'
      this.skipCommentsAndWhitespace()
      this.advance() // consume 'global'
      return this.parseGlobal(schema, true)
    }

    // module declaration
    if (this.matchIdentifier('module')) {
      return this.parseModule()
    }

    // function declaration
    if (this.matchIdentifier('function')) {
      return this.parseFunction()
    }

    // alias declaration
    if (token.type === TokenType.ALIAS || this.checkIdentifier('alias')) {
      return this.parseAlias()
    }

    // abstract type
    if (token.type === TokenType.ABSTRACT || this.checkIdentifier('abstract')) {
      return this.parseAbstractType()
    }

    // scalar type (enum)
    if (token.type === TokenType.SCALAR || this.checkIdentifier('scalar')) {
      return this.parseScalarType()
    }

    // regular type
    if (token.type === TokenType.TYPE || this.checkIdentifier('type')) {
      return this.parseType()
    }

    // Unknown token - skip it
    this.advance()
    return null
  }

  private parseUsing(schema: Schema): null {
    // Already consumed 'using'
    this.skipCommentsAndWhitespace()

    if (this.matchIdentifier('extension')) {
      const name = this.expectIdentifier('extension name')
      schema.extensions.push(name)
      this.consumeOptionalSemicolon()
    }

    return null
  }

  private parseGlobal(schema: Schema, required: boolean): null {
    this.skipCommentsAndWhitespace()
    const name = this.expectIdentifier('global name')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.COLON, ':')
    this.skipCommentsAndWhitespace()

    const type = this.parseTypeName()

    const global: GlobalDefinition = {
      name,
      type,
      required,
      location: { line: this.peek().line, column: this.peek().column },
    }

    // Check for block with default
    if (this.check(TokenType.LBRACE)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        if (this.matchIdentifier('default')) {
          this.skipCommentsAndWhitespace()
          this.expect(TokenType.ASSIGN, ':=')
          this.skipCommentsAndWhitespace()
          global.default = this.parseValue()
          this.consumeOptionalSemicolon()
        } else {
          this.advance()
        }
        this.skipCommentsAndWhitespace()
      }

      this.expect(TokenType.RBRACE, '}')
    }

    this.consumeOptionalSemicolon()
    schema.globals.push(global)

    return null
  }

  private parseModule(): Module {
    this.skipCommentsAndWhitespace()

    // Parse module name (may include ::)
    let name = this.expectIdentifier('module name')
    while (this.check(TokenType.NAMESPACE)) {
      this.advance()
      name += '::' + this.expectIdentifier('module name part')
    }

    this.skipCommentsAndWhitespace()
    this.expect(TokenType.LBRACE, '{')

    const module: Module = {
      name,
      types: [],
      enums: [],
      location: { line: this.peek().line, column: this.peek().column },
    }

    this.skipCommentsAndWhitespace()

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.skipCommentsAndWhitespace()
      if (this.check(TokenType.RBRACE)) break

      const token = this.peek()

      if (token.type === TokenType.ABSTRACT || this.checkIdentifier('abstract')) {
        const typeDef = this.parseAbstractType()
        if (typeDef) module.types.push(typeDef)
      } else if (token.type === TokenType.SCALAR || this.checkIdentifier('scalar')) {
        const scalar = this.parseScalarType()
        if (scalar && 'values' in scalar) {
          module.enums.push(scalar as EnumDefinition)
        }
      } else if (token.type === TokenType.TYPE || this.checkIdentifier('type')) {
        const typeDef = this.parseType()
        if (typeDef) module.types.push(typeDef)
      } else {
        this.advance()
      }

      this.skipCommentsAndWhitespace()
    }

    this.expect(TokenType.RBRACE, '}')

    return module
  }

  private parseFunction(): FunctionDefinition {
    this.skipCommentsAndWhitespace()
    const name = this.expectIdentifier('function name')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.LPAREN, '(')

    const parameters: Array<{ name: string; type: string }> = []

    this.skipCommentsAndWhitespace()
    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      const paramName = this.expectIdentifier('parameter name')
      this.skipCommentsAndWhitespace()
      this.expect(TokenType.COLON, ':')
      this.skipCommentsAndWhitespace()
      const paramType = this.parseTypeName()
      parameters.push({ name: paramName, type: paramType })

      this.skipCommentsAndWhitespace()
      if (this.check(TokenType.COMMA)) {
        this.advance()
        this.skipCommentsAndWhitespace()
      }
    }

    this.expect(TokenType.RPAREN, ')')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.ARROW, '->')
    this.skipCommentsAndWhitespace()

    const returnType = this.parseTypeName()
    this.skipCommentsAndWhitespace()

    // Parse 'using' clause
    this.expectIdentifier('using')
    this.skipCommentsAndWhitespace()
    this.expect(TokenType.LPAREN, '(')

    const body = this.parseExpressionUntil(TokenType.RPAREN)

    this.expect(TokenType.RPAREN, ')')
    this.consumeOptionalSemicolon()

    return {
      name,
      parameters,
      returnType,
      body,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parseAlias(): AliasDefinition {
    if (this.check(TokenType.ALIAS) || this.checkIdentifier('alias')) {
      this.advance()
    }

    this.skipCommentsAndWhitespace()
    const name = this.expectIdentifier('alias name')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.ASSIGN, ':=')
    this.skipCommentsAndWhitespace()

    // Parse until semicolon
    const expression = this.parseExpressionUntil(TokenType.SEMICOLON)

    this.consumeOptionalSemicolon()

    return {
      name,
      expression,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parseAbstractType(): TypeDefinition {
    this.advance() // consume 'abstract'
    this.skipCommentsAndWhitespace()

    const typeDef = this.parseType()
    typeDef.abstract = true

    return typeDef
  }

  private parseScalarType(): EnumDefinition | ScalarDefinition {
    this.advance() // consume 'scalar'
    this.skipCommentsAndWhitespace()

    this.expectKeyword('type')
    this.skipCommentsAndWhitespace()

    const name = this.expectIdentifier('scalar type name')
    this.skipCommentsAndWhitespace()

    this.expectKeyword('extending')
    this.skipCommentsAndWhitespace()

    // Check if it's an enum
    if (this.checkIdentifier('enum')) {
      this.advance()
      this.skipCommentsAndWhitespace()

      this.expect(TokenType.LESS_THAN, '<')
      this.skipCommentsAndWhitespace()

      const values: string[] = []

      while (!this.check(TokenType.GREATER_THAN) && !this.isAtEnd()) {
        const value = this.parseEnumValue()
        values.push(value)

        this.skipCommentsAndWhitespace()
        if (this.check(TokenType.COMMA)) {
          this.advance()
          this.skipCommentsAndWhitespace()
        }
      }

      this.expect(TokenType.GREATER_THAN, '>')
      this.consumeOptionalSemicolon()

      // Track the enum name so we can recognize it later
      this.knownEnums.add(name)

      return {
        name,
        values,
        location: { line: this.peek().line, column: this.peek().column },
      }
    }

    // It's a regular scalar type extension
    const baseType = this.parseTypeName()
    const constraints: PropertyConstraint[] = []

    if (this.check(TokenType.LBRACE)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        if (this.checkIdentifier('constraint')) {
          constraints.push(this.parseConstraint())
        } else {
          this.advance()
        }
        this.skipCommentsAndWhitespace()
      }

      this.expect(TokenType.RBRACE, '}')
    }

    this.consumeOptionalSemicolon()

    return {
      name,
      extends: baseType,
      constraints,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parseEnumValue(): string {
    // Enum values can be identifiers or hyphenated identifiers
    let value = ''

    if (this.check(TokenType.IDENTIFIER)) {
      value = this.advance().value
    } else if (this.check(TokenType.STRING)) {
      value = this.advance().value
    } else {
      // Try to parse as identifier even if it's a keyword
      const token = this.advance()
      value = token.value
    }

    // Handle hyphenated values like 'us-east'
    while (this.check(TokenType.MINUS)) {
      this.advance()
      const next = this.advance()
      value += '-' + next.value
    }

    return value
  }

  private parseType(): TypeDefinition {
    const startToken = this.peek()
    const docComment = this.currentDocComment
    this.currentDocComment = undefined

    if (this.check(TokenType.TYPE) || this.checkIdentifier('type')) {
      this.advance()
    }

    this.skipCommentsAndWhitespace()

    // Check if the type name comes from a keyword token (not backtick-quoted)
    const nameToken = this.peek()
    const isKeywordToken = nameToken.type !== TokenType.IDENTIFIER
    const name = this.parseTypeName()

    // Check for reserved keyword as type name - only if it's a keyword token (not backtick-quoted)
    if (isKeywordToken && RESERVED_KEYWORDS.has(name.toLowerCase())) {
      throw new ParseError(`Cannot use reserved keyword '${name}' as type name`, startToken.line, startToken.column)
    }

    // Check for invalid type name starting with number
    if (/^\d/.test(name)) {
      throw new ParseError(`Type name cannot start with a number: ${name}`, startToken.line, startToken.column)
    }

    this.skipCommentsAndWhitespace()

    const extendsTypes: string[] = []

    if (this.check(TokenType.EXTENDING) || this.checkIdentifier('extending')) {
      this.advance()
      this.skipCommentsAndWhitespace()

      // Parse comma-separated list of parent types
      do {
        const parentType = this.parseTypeName()
        extendsTypes.push(parentType)
        this.skipCommentsAndWhitespace()

        if (this.check(TokenType.COMMA)) {
          this.advance()
          this.skipCommentsAndWhitespace()
        } else {
          break
        }
      } while (!this.check(TokenType.LBRACE) && !this.isAtEnd())
    }

    this.skipCommentsAndWhitespace()
    this.expect(TokenType.LBRACE, '{')

    const typeDef: TypeDefinition = {
      name,
      abstract: false,
      extends: extendsTypes,
      properties: [],
      links: [],
      backlinks: [],
      computedProperties: [],
      constraints: [],
      indexes: [],
      location: { line: startToken.line, column: startToken.column },
      raw: this.extractRaw(startToken),
    }

    if (docComment) {
      typeDef.doc = docComment
    }

    this.skipCommentsAndWhitespace()

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.parseTypeMember(typeDef)
      this.skipCommentsAndWhitespace()
    }

    this.expect(TokenType.RBRACE, '}')

    return typeDef
  }

  private parseTypeMember(typeDef: TypeDefinition): void {
    this.skipCommentsAndWhitespace()
    if (this.check(TokenType.RBRACE) || this.isAtEnd()) return

    // Check for various member types
    if (this.checkIdentifier('annotation')) {
      this.parseTypeAnnotation(typeDef)
      return
    }

    if (this.check(TokenType.INDEX) || this.checkIdentifier('index')) {
      // Lookahead to distinguish 'index on (...)' from property named 'index'
      // Skip any comment tokens to find the next meaningful token
      let nextPos = this.pos + 1
      while (nextPos < this.tokens.length && this.tokens[nextPos].type === TokenType.COMMENT) {
        nextPos++
      }
      if (nextPos < this.tokens.length) {
        const nextToken = this.tokens[nextPos]
        // If next token is 'on', it's definitely an index definition
        if (nextToken.value.toLowerCase() === 'on') {
          typeDef.indexes.push(this.parseIndex())
          return
        }
        // If next token is an identifier (like fts), check if 'on' comes after
        if (nextToken.type === TokenType.IDENTIFIER) {
          // Skip to find 'on' after the using clause
          let checkPos = nextPos + 1
          while (checkPos < this.tokens.length && this.tokens[checkPos].type === TokenType.COMMENT) {
            checkPos++
          }
          // Check for namespace (fts::index) or 'on'
          if (checkPos < this.tokens.length) {
            const afterToken = this.tokens[checkPos]
            if (afterToken.type === TokenType.NAMESPACE || afterToken.value.toLowerCase() === 'on') {
              typeDef.indexes.push(this.parseIndex())
              return
            }
          }
        }
      }
      // Otherwise, fall through to property parsing
    }

    if (this.checkIdentifier('constraint')) {
      typeDef.constraints.push(this.parseTypeConstraint())
      return
    }

    if (this.checkIdentifier('trigger')) {
      const trigger = this.parseTrigger()
      if (!typeDef.triggers) typeDef.triggers = []
      typeDef.triggers.push(trigger)
      return
    }

    if (this.checkIdentifier('access')) {
      const policy = this.parseAccessPolicy()
      if (!typeDef.accessPolicies) typeDef.accessPolicies = []
      typeDef.accessPolicies.push(policy)
      return
    }

    // Parse property/link with modifiers
    this.parsePropertyOrLink(typeDef)
  }

  private parseTypeAnnotation(typeDef: TypeDefinition): void {
    this.advance() // consume 'annotation'
    this.skipCommentsAndWhitespace()

    const name = this.expectIdentifier('annotation name')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.ASSIGN, ':=')
    this.skipCommentsAndWhitespace()

    const value = this.parseStringValue()

    if (!typeDef.annotations) typeDef.annotations = {}
    typeDef.annotations[name] = value

    this.consumeOptionalSemicolon()
  }

  private parseIndex(): Index {
    this.advance() // consume 'index'
    this.skipCommentsAndWhitespace()

    let using: string | undefined

    // Check for fts::index or other index type
    if (this.check(TokenType.IDENTIFIER) && !this.checkIdentifier('on')) {
      using = this.parseTypeName()
      this.skipCommentsAndWhitespace()
    }

    this.expectIdentifier('on')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.LPAREN, '(')
    this.skipCommentsAndWhitespace()

    const index: Index = {
      on: [],
      location: { line: this.peek().line, column: this.peek().column },
    }

    if (using) {
      index.using = using
    }

    // Check if it's an expression, a list of properties, or a single property
    if (this.check(TokenType.LPAREN)) {
      // Composite index on multiple properties like (.prop1, .prop2)
      this.advance()
      this.skipCommentsAndWhitespace()

      while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
        const prop = this.parsePathExpression()
        index.on.push(prop)

        this.skipCommentsAndWhitespace()
        if (this.check(TokenType.COMMA)) {
          this.advance()
          this.skipCommentsAndWhitespace()
        }
      }

      this.expect(TokenType.RPAREN, ')')
    } else if (this.check(TokenType.DOT)) {
      // Single property index like .name
      const prop = this.parsePathExpression()
      index.on.push(prop)
    } else if (this.check(TokenType.IDENTIFIER)) {
      // Expression index like str_lower(.name)
      // Parse the entire expression until closing paren
      const expr = this.parseExpressionUntil(TokenType.RPAREN)
      index.expression = expr
    } else {
      // Any other expression
      const expr = this.parseExpressionUntil(TokenType.RPAREN)
      if (expr) index.expression = expr
    }

    this.skipCommentsAndWhitespace()
    this.expect(TokenType.RPAREN, ')')

    // Check for block with annotations/deferred
    if (this.check(TokenType.LBRACE)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        if (this.checkIdentifier('annotation')) {
          this.advance()
          this.skipCommentsAndWhitespace()
          const name = this.expectIdentifier('annotation name')
          this.skipCommentsAndWhitespace()
          this.expect(TokenType.ASSIGN, ':=')
          this.skipCommentsAndWhitespace()
          const value = this.parseStringValue()
          if (!index.annotations) index.annotations = {}
          index.annotations[name] = value
          this.consumeOptionalSemicolon()
        } else if (this.checkIdentifier('deferred')) {
          this.advance()
          this.skipCommentsAndWhitespace()
          this.expect(TokenType.ASSIGN, ':=')
          this.skipCommentsAndWhitespace()
          const value = this.advance()
          index.deferred = value.value === 'true'
          this.consumeOptionalSemicolon()
        } else {
          this.advance()
        }
        this.skipCommentsAndWhitespace()
      }

      this.expect(TokenType.RBRACE, '}')
    }

    this.consumeOptionalSemicolon()

    return index
  }

  private parseTypeConstraint(): PropertyConstraint {
    this.advance() // consume 'constraint'
    this.skipCommentsAndWhitespace()

    const constraintType = this.expectIdentifier('constraint type')
    this.skipCommentsAndWhitespace()

    const constraint: PropertyConstraint = { type: constraintType }

    if (this.checkIdentifier('on')) {
      this.advance()
      this.skipCommentsAndWhitespace()
      this.expect(TokenType.LPAREN, '(')
      this.skipCommentsAndWhitespace()

      if (constraintType === 'expression') {
        // Expression constraint
        constraint.expr = this.parseExpressionUntil(TokenType.RPAREN)
      } else {
        // Exclusive on multiple properties
        const props: string[] = []

        if (this.check(TokenType.LPAREN)) {
          this.advance()
          this.skipCommentsAndWhitespace()

          while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
            const prop = this.parsePathExpression()
            props.push(prop)

            this.skipCommentsAndWhitespace()
            if (this.check(TokenType.COMMA)) {
              this.advance()
              this.skipCommentsAndWhitespace()
            }
          }

          this.expect(TokenType.RPAREN, ')')
        } else {
          const prop = this.parsePathExpression()
          props.push(prop)
        }

        constraint.on = props
      }

      this.skipCommentsAndWhitespace()
      this.expect(TokenType.RPAREN, ')')
    }

    this.consumeOptionalSemicolon()

    return constraint
  }

  private parseTrigger(): Trigger {
    this.advance() // consume 'trigger'
    this.skipCommentsAndWhitespace()

    const name = this.expectIdentifier('trigger name')
    this.skipCommentsAndWhitespace()

    let timing: 'before' | 'after' = 'after'
    if (this.checkIdentifier('before')) {
      timing = 'before'
      this.advance()
    } else if (this.checkIdentifier('after')) {
      timing = 'after'
      this.advance()
    }

    this.skipCommentsAndWhitespace()

    const event = this.expectIdentifier('trigger event')
    this.skipCommentsAndWhitespace()

    // Skip 'for each'
    if (this.checkIdentifier('for')) {
      this.advance()
      this.skipCommentsAndWhitespace()
      if (this.checkIdentifier('each')) {
        this.advance()
        this.skipCommentsAndWhitespace()
      }
    }

    let condition: string | undefined

    // Parse 'when' clause
    if (this.checkIdentifier('when')) {
      this.advance()
      this.skipCommentsAndWhitespace()
      this.expect(TokenType.LPAREN, '(')
      condition = this.parseExpressionUntil(TokenType.RPAREN)
      this.expect(TokenType.RPAREN, ')')
      this.skipCommentsAndWhitespace()
    }

    // Parse 'do' clause
    this.expectIdentifier('do')
    this.skipCommentsAndWhitespace()
    this.expect(TokenType.LPAREN, '(')

    const action = this.parseExpressionUntil(TokenType.RPAREN)

    this.expect(TokenType.RPAREN, ')')
    this.consumeOptionalSemicolon()

    return {
      name,
      timing,
      event,
      condition,
      action,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parseAccessPolicy(): AccessPolicy {
    this.advance() // consume 'access'
    this.skipCommentsAndWhitespace()

    this.expectIdentifier('policy')
    this.skipCommentsAndWhitespace()

    const name = this.expectIdentifier('policy name')
    this.skipCommentsAndWhitespace()

    this.expectIdentifier('allow')
    this.skipCommentsAndWhitespace()

    const allow: string[] = []

    // Parse comma-separated list of operations or 'all'
    do {
      const op = this.expectIdentifier('operation')
      allow.push(op)

      this.skipCommentsAndWhitespace()
      if (this.check(TokenType.COMMA)) {
        this.advance()
        this.skipCommentsAndWhitespace()
      } else {
        break
      }
    } while (!this.checkIdentifier('using') && !this.isAtEnd())

    this.skipCommentsAndWhitespace()
    this.expectIdentifier('using')
    this.skipCommentsAndWhitespace()

    this.expect(TokenType.LPAREN, '(')
    const condition = this.parseExpressionUntil(TokenType.RPAREN)
    this.expect(TokenType.RPAREN, ')')
    this.consumeOptionalSemicolon()

    return {
      name,
      allow,
      condition,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parsePropertyOrLink(typeDef: TypeDefinition): void {
    const startToken = this.peek()

    // Parse modifiers
    let required = false
    let optional = false
    let multi = false
    let single = false
    let readonly = false
    let overloaded = false
    let isProperty = false
    let isLink = false
    let cardinality: 'single' | 'multi' = 'single'

    // Collect modifiers
    while (true) {
      this.skipCommentsAndWhitespace()

      if (this.check(TokenType.REQUIRED) || this.checkIdentifier('required')) {
        required = true
        this.advance()
      } else if (this.check(TokenType.OPTIONAL) || this.checkIdentifier('optional')) {
        optional = true
        this.advance()
      } else if (this.check(TokenType.MULTI) || this.checkIdentifier('multi')) {
        multi = true
        cardinality = 'multi'
        this.advance()
      } else if (this.check(TokenType.SINGLE) || this.checkIdentifier('single')) {
        single = true
        this.advance()
      } else if (this.checkIdentifier('readonly')) {
        readonly = true
        this.advance()
      } else if (this.checkIdentifier('overloaded')) {
        overloaded = true
        this.advance()
      } else if (this.check(TokenType.PROPERTY) || this.checkIdentifier('property')) {
        isProperty = true
        this.advance()
      } else if (this.check(TokenType.LINK) || this.checkIdentifier('link')) {
        isLink = true
        this.advance()
      } else {
        break
      }
    }

    this.skipCommentsAndWhitespace()

    if (this.check(TokenType.RBRACE) || this.isAtEnd()) return

    const name = this.expectIdentifier('property/link name')
    this.skipCommentsAndWhitespace()

    // Check for computed property (uses :=)
    if (this.check(TokenType.ASSIGN)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      const expression = this.parseComputedExpression()

      // Check if this is a backlink
      if (expression.includes('.<')) {
        const backlink = this.parseBacklinkFromExpression(name, expression, cardinality)
        typeDef.backlinks.push(backlink)
        // Also add to computedProperties for completeness
        const computed: ComputedProperty = {
          name,
          expression,
          cardinality: multi ? 'multi' : undefined,
          location: { line: startToken.line, column: startToken.column },
        }
        typeDef.computedProperties.push(computed)
      } else {
        const computed: ComputedProperty = {
          name,
          expression,
          cardinality: multi ? 'multi' : undefined,
          location: { line: startToken.line, column: startToken.column },
        }
        typeDef.computedProperties.push(computed)
      }

      this.consumeOptionalSemicolon()
      return
    }

    // Check for computed with return type (property name -> type := expr)
    if (this.check(TokenType.ARROW)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      const returnType = this.parseTypeName()
      this.skipCommentsAndWhitespace()

      this.expect(TokenType.ASSIGN, ':=')
      this.skipCommentsAndWhitespace()

      const expression = this.parseComputedExpression()

      const computed: ComputedProperty = {
        name,
        expression,
        returnType,
        cardinality: multi ? 'multi' : undefined,
        location: { line: startToken.line, column: startToken.column },
      }
      typeDef.computedProperties.push(computed)

      this.consumeOptionalSemicolon()
      return
    }

    // Regular property or link with type
    this.expect(TokenType.COLON, ':')
    this.skipCommentsAndWhitespace()

    const typeName = this.parseTypeName()
    this.skipCommentsAndWhitespace()

    // Check if it's an array or tuple
    let elementType: string | undefined
    let tupleTypes: string[] | undefined
    let tupleFields: Record<string, string> | undefined
    let finalType = typeName

    if (typeName === 'array' && this.check(TokenType.LESS_THAN)) {
      this.advance()
      this.skipCommentsAndWhitespace()
      elementType = this.parseTypeName()
      this.skipCommentsAndWhitespace()
      this.expect(TokenType.GREATER_THAN, '>')
    } else if (typeName === 'tuple' && this.check(TokenType.LESS_THAN)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      const { types, fields } = this.parseTupleTypeArgs()
      tupleTypes = types
      tupleFields = fields
    }

    // Determine if this is a link (references another type) or a property (primitive type)
    const isPrimitiveType = PRIMITIVE_TYPES.has(typeName) ||
                           typeName === 'array' ||
                           typeName === 'tuple' ||
                           typeName.startsWith('cal::')

    // Check if it's a known enum type (defined earlier in the schema)
    const isEnumType = this.knownEnums.has(typeName)

    // If it's a primitive, array, tuple, or known enum, it's a property, not a link
    // If it's explicitly marked as 'property', it's a property
    // Otherwise, if it's not a primitive/enum and not marked as property, it's a link
    const isLinkType = !isPrimitiveType && !isProperty && !isEnumType

    if (isLinkType || isLink) {
      // This is a link
      const link: Link = {
        name,
        target: typeName,
        required,
        cardinality,
        overloaded: overloaded || undefined,
        location: { line: startToken.line, column: startToken.column },
      }

      // Parse link block if present
      if (this.check(TokenType.LBRACE)) {
        this.parseLinkBlock(link)
      }

      typeDef.links.push(link)
    } else {
      // This is a property
      const property: Property = {
        name,
        type: finalType,
        required,
        optional: optional || undefined,
        readonly,
        overloaded: overloaded || undefined,
        constraints: [],
        location: { line: startToken.line, column: startToken.column },
      }

      if (elementType) property.elementType = elementType
      if (tupleTypes) property.tupleTypes = tupleTypes
      if (tupleFields) property.tupleFields = tupleFields

      // Parse property block if present
      if (this.check(TokenType.LBRACE)) {
        this.parsePropertyBlock(property)
      }

      typeDef.properties.push(property)
    }

    this.consumeOptionalSemicolon()
  }

  private parseTupleTypeArgs(): { types?: string[]; fields?: Record<string, string> } {
    const types: string[] = []
    const fields: Record<string, string> = {}
    let isNamed = false

    while (!this.check(TokenType.GREATER_THAN) && !this.isAtEnd()) {
      const first = this.parseTypeName()
      this.skipCommentsAndWhitespace()

      if (this.check(TokenType.COLON)) {
        // Named tuple field: name: type
        isNamed = true
        this.advance()
        this.skipCommentsAndWhitespace()
        const type = this.parseTypeName()
        fields[first] = type
      } else {
        // Unnamed tuple element
        types.push(first)
      }

      this.skipCommentsAndWhitespace()
      if (this.check(TokenType.COMMA)) {
        this.advance()
        this.skipCommentsAndWhitespace()
      }
    }

    this.expect(TokenType.GREATER_THAN, '>')

    if (isNamed) {
      return { fields }
    }
    return { types }
  }

  private parseBacklinkFromExpression(name: string, expression: string, cardinality: 'single' | 'multi'): Backlink {
    // Parse expression like: .<author[IS Post] or .<author[IS Post | Comment] or .<author[IS blog::Post]
    // Handle module-qualified types like blog::Post
    // Note: The reconstructed expression may have spaces around IS like .<author[ IS Post]
    const match = expression.match(/\.<(\w+)\[\s*IS\s+([^\]]+)\]/)

    if (match) {
      const forwardLink = match[1]
      const targetTypeStr = match[2].trim()

      // Check for union type: Post | Comment
      if (targetTypeStr.includes('|')) {
        const targetTypes = targetTypeStr.split('|').map(t => t.trim())
        return {
          name,
          forwardLink,
          targetType: targetTypes,
          cardinality,
          expression: expression.includes('union') ? expression : undefined,
          location: { line: this.peek().line, column: this.peek().column },
        }
      }

      return {
        name,
        forwardLink,
        targetType: targetTypeStr, // This now correctly includes module-qualified names like 'blog::Post'
        cardinality,
        expression: expression.includes('union') ? expression : undefined,
        location: { line: this.peek().line, column: this.peek().column },
      }
    }

    // Handle complex backlink expressions
    return {
      name,
      forwardLink: '',
      targetType: '',
      cardinality,
      expression,
      location: { line: this.peek().line, column: this.peek().column },
    }
  }

  private parseLinkBlock(link: Link): void {
    this.expect(TokenType.LBRACE, '{')
    this.skipCommentsAndWhitespace()

    const properties: LinkProperty[] = []
    const constraints: PropertyConstraint[] = []

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.skipCommentsAndWhitespace()

      if (this.checkIdentifier('constraint')) {
        constraints.push(this.parseConstraint())
      } else if (this.checkIdentifier('on')) {
        // on target delete
        this.advance()
        this.skipCommentsAndWhitespace()
        this.expectIdentifier('target')
        this.skipCommentsAndWhitespace()
        this.expectIdentifier('delete')
        this.skipCommentsAndWhitespace()

        // Parse the action: restrict, allow, delete source, deferred restrict
        let action = this.expectIdentifier('delete action')
        this.skipCommentsAndWhitespace()

        if (action === 'delete' && this.checkIdentifier('source')) {
          this.advance()
          action = 'delete source'
        } else if (action === 'deferred' && this.checkIdentifier('restrict')) {
          this.advance()
          action = 'deferred restrict'
        }

        link.onTargetDelete = action
        this.consumeOptionalSemicolon()
      } else if (this.check(TokenType.REQUIRED) || this.checkIdentifier('required')) {
        // Link property with required modifier
        this.advance()
        this.skipCommentsAndWhitespace()
        const propName = this.expectIdentifier('property name')
        this.skipCommentsAndWhitespace()
        this.expect(TokenType.COLON, ':')
        this.skipCommentsAndWhitespace()
        const propType = this.parseTypeName()

        properties.push({
          name: propName,
          type: propType,
          required: true,
        })

        this.consumeOptionalSemicolon()
      } else if (this.check(TokenType.IDENTIFIER)) {
        // Regular link property
        const propName = this.expectIdentifier('property name')
        this.skipCommentsAndWhitespace()
        this.expect(TokenType.COLON, ':')
        this.skipCommentsAndWhitespace()
        const propType = this.parseTypeName()

        const prop: LinkProperty = {
          name: propName,
          type: propType,
          required: false,
        }

        // Check for property block with default
        if (this.check(TokenType.LBRACE)) {
          this.advance()
          this.skipCommentsAndWhitespace()

          while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
            if (this.checkIdentifier('default')) {
              this.advance()
              this.skipCommentsAndWhitespace()
              this.expect(TokenType.ASSIGN, ':=')
              this.skipCommentsAndWhitespace()
              prop.default = this.parseValue()
              this.consumeOptionalSemicolon()
            } else {
              this.advance()
            }
            this.skipCommentsAndWhitespace()
          }

          this.expect(TokenType.RBRACE, '}')
        }

        properties.push(prop)
        this.consumeOptionalSemicolon()
      } else {
        this.advance()
      }

      this.skipCommentsAndWhitespace()
    }

    this.expect(TokenType.RBRACE, '}')

    if (properties.length > 0) link.properties = properties
    if (constraints.length > 0) link.constraints = constraints
  }

  private parsePropertyBlock(property: Property): void {
    this.expect(TokenType.LBRACE, '{')
    this.skipCommentsAndWhitespace()

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      this.skipCommentsAndWhitespace()

      if (this.checkIdentifier('default')) {
        this.advance()
        this.skipCommentsAndWhitespace()
        this.expect(TokenType.ASSIGN, ':=')
        this.skipCommentsAndWhitespace()

        const { value, isExpr } = this.parseDefaultValue()
        if (isExpr) {
          property.defaultExpr = value as string
        } else {
          property.default = value
        }
        this.consumeOptionalSemicolon()
      } else if (this.checkIdentifier('constraint') || this.checkIdentifier('delegated')) {
        property.constraints.push(this.parseConstraint())
      } else if (this.checkIdentifier('annotation')) {
        this.advance()
        this.skipCommentsAndWhitespace()
        const name = this.expectIdentifier('annotation name')
        this.skipCommentsAndWhitespace()
        this.expect(TokenType.ASSIGN, ':=')
        this.skipCommentsAndWhitespace()
        const value = this.parseStringValue()
        if (!property.annotations) property.annotations = {}
        property.annotations[name] = value
        this.consumeOptionalSemicolon()
      } else if (this.checkIdentifier('rewrite')) {
        this.advance()
        this.skipCommentsAndWhitespace()

        const trigger = this.expectIdentifier('rewrite trigger') as 'insert' | 'update'
        this.skipCommentsAndWhitespace()

        this.expectIdentifier('using')
        this.skipCommentsAndWhitespace()
        this.expect(TokenType.LPAREN, '(')

        const expression = this.parseExpressionUntil(TokenType.RPAREN)
        this.expect(TokenType.RPAREN, ')')

        if (!property.rewrites) property.rewrites = []
        property.rewrites.push({ trigger, expression })

        this.consumeOptionalSemicolon()
      } else {
        this.advance()
      }

      this.skipCommentsAndWhitespace()
    }

    this.expect(TokenType.RBRACE, '}')
  }

  private parseConstraint(): PropertyConstraint {
    // Check for 'delegated constraint' vs 'constraint'
    let delegated = false
    if (this.checkIdentifier('delegated')) {
      delegated = true
      this.advance() // consume 'delegated'
      this.skipCommentsAndWhitespace()
      this.expectKeyword('constraint') // expect 'constraint' after 'delegated'
      this.skipCommentsAndWhitespace()
    } else {
      this.advance() // consume 'constraint'
      this.skipCommentsAndWhitespace()
    }

    const constraintType = this.expectIdentifier('constraint type')
    this.skipCommentsAndWhitespace()

    const constraint: PropertyConstraint = { type: constraintType }
    if (delegated) constraint.delegated = true

    // Parse constraint arguments
    if (this.check(TokenType.LPAREN)) {
      this.advance()
      this.skipCommentsAndWhitespace()

      if (constraintType === 'one_of') {
        const values: string[] = []
        while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
          if (this.check(TokenType.STRING)) {
            values.push(this.advance().value)
          } else {
            this.advance()
          }
          this.skipCommentsAndWhitespace()
          if (this.check(TokenType.COMMA)) {
            this.advance()
            this.skipCommentsAndWhitespace()
          }
        }
        constraint.values = values
      } else if (constraintType === 'regexp') {
        // Parse regex pattern (may be raw string r'...' or regular string)
        let pattern = ''
        if (this.check(TokenType.STRING)) {
          pattern = this.advance().value
        } else if (this.check(TokenType.IDENTIFIER) && this.peek().value === 'r') {
          this.advance() // consume 'r'
          pattern = this.advance().value
        }
        constraint.pattern = pattern
      } else {
        // Numeric constraint (min_value, max_value, etc.)
        let negative = false
        if (this.check(TokenType.MINUS)) {
          negative = true
          this.advance()
        }

        if (this.check(TokenType.NUMBER)) {
          let value = parseFloat(this.advance().value)
          if (negative) value = -value
          constraint.value = value
        }
      }

      this.skipCommentsAndWhitespace()
      this.expect(TokenType.RPAREN, ')')
    }

    this.consumeOptionalSemicolon()

    return constraint
  }

  private parseDefaultValue(): { value: string | number | boolean; isExpr: boolean } {
    // Check for function call or enum value
    if (this.check(TokenType.IDENTIFIER)) {
      const ident = this.peek().value
      const savedPos = this.pos
      this.advance()
      this.skipCommentsAndWhitespace()

      // Check for function call
      if (this.check(TokenType.LPAREN)) {
        this.advance()
        const expr = ident + '(' + this.parseExpressionUntil(TokenType.RPAREN) + ')'
        this.expect(TokenType.RPAREN, ')')
        return { value: expr, isExpr: true }
      }

      // Check for enum value (EnumType.value)
      if (this.check(TokenType.DOT)) {
        this.advance()
        const enumValue = this.expectIdentifier('enum value')
        return { value: ident + '.' + enumValue, isExpr: true }
      }

      // Check for boolean
      if (ident === 'true') return { value: true, isExpr: false }
      if (ident === 'false') return { value: false, isExpr: false }

      // Otherwise it's an expression
      return { value: ident, isExpr: true }
    }

    const value = this.parseValue()
    return { value, isExpr: false }
  }

  private parseValue(): string | number | boolean {
    if (this.check(TokenType.STRING)) {
      return this.advance().value
    }

    if (this.check(TokenType.NUMBER)) {
      const num = this.advance().value
      return num.includes('.') ? parseFloat(num) : parseInt(num, 10)
    }

    if (this.check(TokenType.TRUE) || (this.check(TokenType.IDENTIFIER) && this.peek().value === 'true')) {
      this.advance()
      return true
    }

    if (this.check(TokenType.FALSE) || (this.check(TokenType.IDENTIFIER) && this.peek().value === 'false')) {
      this.advance()
      return false
    }

    // Default case - treat as string
    return this.advance().value
  }

  private parseStringValue(): string {
    if (this.check(TokenType.STRING)) {
      return this.advance().value
    }
    throw new ParseError('Expected string value', this.peek().line, this.peek().column)
  }

  private parseComputedExpression(): string {
    const parts: string[] = []
    let parenDepth = 0
    let braceDepth = 0
    let bracketDepth = 0

    while (!this.isAtEnd()) {
      const token = this.peek()

      if (token.type === TokenType.LPAREN) parenDepth++
      if (token.type === TokenType.RPAREN) parenDepth--
      if (token.type === TokenType.LBRACE) braceDepth++
      if (token.type === TokenType.RBRACE) braceDepth--
      if (token.type === TokenType.LBRACKET) bracketDepth++
      if (token.type === TokenType.RBRACKET) bracketDepth--

      // Stop at semicolon when all brackets are balanced
      if (token.type === TokenType.SEMICOLON && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        break
      }

      // Stop at closing brace of containing type when balanced
      if (token.type === TokenType.RBRACE && braceDepth < 0) {
        break
      }

      parts.push(this.getTokenText(token))
      this.advance()
    }

    return parts.join('').trim()
  }

  private parseExpressionUntil(endToken: TokenType): string {
    const parts: string[] = []
    let parenDepth = 0

    while (!this.isAtEnd()) {
      const token = this.peek()

      // Check for end condition BEFORE modifying parenDepth
      if (token.type === endToken && parenDepth === 0) break

      if (token.type === TokenType.LPAREN) parenDepth++
      if (token.type === TokenType.RPAREN) parenDepth--

      parts.push(this.getTokenText(token))
      this.advance()
    }

    return parts.join('').trim()
  }

  private getTokenText(token: Token): string {
    // Reconstruct text from token
    switch (token.type) {
      case TokenType.ASSIGN:
        return ' := '
      case TokenType.NAMESPACE:
        return '::'
      case TokenType.COLON:
        return ': '
      case TokenType.COMMA:
        return ', '
      case TokenType.SEMICOLON:
        return '; '
      case TokenType.DOT:
        return '.'
      case TokenType.ARROW:
        return ' -> '
      case TokenType.CONCAT:
        return ' ++ '
      case TokenType.EQUALS:
        return ' = '
      case TokenType.NOT_EQUALS:
        return ' != '
      case TokenType.LESS_THAN:
        return ' < '
      case TokenType.GREATER_THAN:
        return ' > '
      case TokenType.LESS_EQUAL:
        return ' <= '
      case TokenType.GREATER_EQUAL:
        return ' >= '
      case TokenType.PLUS:
        return ' + '
      case TokenType.MINUS:
        return ' - '
      case TokenType.MULTIPLY:
        return ' * '
      case TokenType.DIVIDE:
        return ' / '
      case TokenType.LPAREN:
        return '('
      case TokenType.RPAREN:
        return ')'
      case TokenType.LBRACE:
        return '{'
      case TokenType.RBRACE:
        return '}'
      case TokenType.LBRACKET:
        return '['
      case TokenType.RBRACKET:
        return ']'
      case TokenType.BACKWARD_LINK:
        return '.<'
      case TokenType.PIPE:
        return ' | '
      case TokenType.STRING:
        return `'${token.value}'`
      case TokenType.IS:
        return ' IS '
      case TokenType.AND:
        return ' and '
      case TokenType.OR:
        return ' or '
      case TokenType.NOT:
        return ' not '
      case TokenType.IN:
        return ' in '
      case TokenType.LIKE:
        return ' like '
      case TokenType.ILIKE:
        return ' ilike '
      case TokenType.UNION:
        return ' union '
      default:
        return token.value
    }
  }

  private parseTypeName(): string {
    let name = ''

    if (this.check(TokenType.IDENTIFIER)) {
      name = this.advance().value
    } else {
      // Handle keywords that might be used as type names
      name = this.advance().value
    }

    // Handle module-qualified names (cal::local_date, auth::User, etc.)
    while (this.check(TokenType.NAMESPACE)) {
      this.advance()
      name += '::' + this.expectIdentifier('type name part')
    }

    return name
  }

  private parsePathExpression(): string {
    let path = ''

    if (this.check(TokenType.DOT)) {
      path = '.'
      this.advance()
    }

    path += this.expectIdentifier('path component')

    while (this.check(TokenType.DOT)) {
      this.advance()
      path += '.' + this.expectIdentifier('path component')
    }

    return path
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === TokenType.EOF
  }

  private peek(): Token {
    if (this.pos >= this.tokens.length) {
      return { type: TokenType.EOF, value: '', position: 0, line: 0, column: 0 }
    }
    return this.tokens[this.pos]
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      return this.tokens[this.pos++]
    }
    return this.tokens[this.tokens.length - 1]
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type
  }

  private checkIdentifier(value: string): boolean {
    const token = this.peek()
    return (token.type === TokenType.IDENTIFIER ||
            token.type === TokenType.REQUIRED ||
            token.type === TokenType.OPTIONAL ||
            token.type === TokenType.MULTI ||
            token.type === TokenType.SINGLE ||
            token.type === TokenType.ABSTRACT ||
            token.type === TokenType.TYPE ||
            token.type === TokenType.SCALAR ||
            token.type === TokenType.CONSTRAINT ||
            token.type === TokenType.INDEX ||
            token.type === TokenType.ANNOTATION ||
            token.type === TokenType.MODULE ||
            token.type === TokenType.ALIAS ||
            token.type === TokenType.FUNCTION ||
            token.type === TokenType.PROPERTY ||
            token.type === TokenType.LINK ||
            token.type === TokenType.EXTENDING ||
            token.type === TokenType.ENUM ||
            token.type === TokenType.FOR ||
            token.type === TokenType.IF ||
            token.type === TokenType.ELSE ||
            token.type === TokenType.WITH ||
            token.type === TokenType.SELECT ||
            token.type === TokenType.INSERT ||
            token.type === TokenType.UPDATE ||
            token.type === TokenType.DELETE ||
            token.type === TokenType.FILTER ||
            token.type === TokenType.ORDER ||
            token.type === TokenType.BY ||
            token.type === TokenType.LIMIT ||
            token.type === TokenType.OFFSET) &&
           token.value.toLowerCase() === value.toLowerCase()
  }

  private peekIdentifier(value: string): boolean {
    const nextPos = this.pos + 1
    if (nextPos >= this.tokens.length) return false
    const token = this.tokens[nextPos]
    return token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === value.toLowerCase()
  }

  private matchIdentifier(value: string): boolean {
    if (this.checkIdentifier(value)) {
      this.advance()
      return true
    }
    return false
  }

  private expect(type: TokenType, expected: string): Token {
    if (!this.check(type)) {
      throw new ParseError(`Expected '${expected}'`, this.peek().line, this.peek().column)
    }
    return this.advance()
  }

  private expectKeyword(keyword: string): void {
    if (!this.checkIdentifier(keyword)) {
      throw new ParseError(`Expected '${keyword}'`, this.peek().line, this.peek().column)
    }
    this.advance()
  }

  private expectIdentifier(context: string): string {
    const token = this.peek()

    // Accept keywords as identifiers in certain contexts
    if (token.type === TokenType.IDENTIFIER ||
        token.type === TokenType.REQUIRED ||
        token.type === TokenType.OPTIONAL ||
        token.type === TokenType.MULTI ||
        token.type === TokenType.SINGLE ||
        token.type === TokenType.ABSTRACT ||
        token.type === TokenType.TYPE ||
        token.type === TokenType.SCALAR ||
        token.type === TokenType.CONSTRAINT ||
        token.type === TokenType.INDEX ||
        token.type === TokenType.ANNOTATION ||
        token.type === TokenType.MODULE ||
        token.type === TokenType.ALIAS ||
        token.type === TokenType.FUNCTION ||
        token.type === TokenType.PROPERTY ||
        token.type === TokenType.LINK ||
        token.type === TokenType.EXTENDING ||
        token.type === TokenType.ENUM ||
        token.type === TokenType.TRUE ||
        token.type === TokenType.FALSE ||
        token.type === TokenType.SELECT ||
        token.type === TokenType.INSERT ||
        token.type === TokenType.UPDATE ||
        token.type === TokenType.DELETE ||
        token.type === TokenType.FILTER ||
        token.type === TokenType.ORDER ||
        token.type === TokenType.BY ||
        token.type === TokenType.LIMIT ||
        token.type === TokenType.OFFSET ||
        token.type === TokenType.WITH ||
        token.type === TokenType.FOR ||
        token.type === TokenType.IF ||
        token.type === TokenType.ELSE ||
        token.type === TokenType.AND ||
        token.type === TokenType.OR ||
        token.type === TokenType.NOT ||
        token.type === TokenType.IN ||
        token.type === TokenType.LIKE ||
        token.type === TokenType.ILIKE ||
        token.type === TokenType.IS ||
        token.type === TokenType.EXISTS ||
        token.type === TokenType.DISTINCT ||
        token.type === TokenType.UNION ||
        token.type === TokenType.INTERSECT ||
        token.type === TokenType.EXCEPT) {
      this.advance()
      return token.value
    }

    throw new ParseError(`Expected ${context}`, token.line, token.column)
  }

  private consumeOptionalSemicolon(): void {
    this.skipCommentsAndWhitespace()
    if (this.check(TokenType.SEMICOLON)) {
      this.advance()
    }
  }

  private requireSemicolon(): void {
    this.skipCommentsAndWhitespace()
    if (!this.check(TokenType.SEMICOLON)) {
      throw new ParseError(`Expected ';'`, this.peek().line, this.peek().column)
    }
    this.advance()
  }

  private extractRaw(startToken: Token): string {
    // Extract raw SDL text from source
    const startPos = startToken.position
    const endPos = this.peek().position
    return this.source.slice(startPos, endPos).trim()
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parse SDL (Schema Definition Language) into a Schema IR
 *
 * @param sdl - The SDL source code to parse
 * @returns Schema intermediate representation
 * @throws Error if SDL syntax is invalid
 */
export function parseSDL(sdl: string): Schema {
  const parser = new SDLParser(sdl)
  return parser.parse()
}
