/**
 * Typesafe Bloblang DSL Builder
 * Issue: dotdo-nz80p
 *
 * A fluent TypeScript API for building Bloblang expressions with full type safety.
 *
 * Usage:
 *   import { $ } from './builder'
 *   const expr = $.root.user.set($.this.name.uppercase())
 *   expr.toString() // -> 'root.user = this.name.uppercase()'
 */

import type { ASTNode } from './ast'

// Internal expression types for tracking context
type ExprType =
  | 'root'
  | 'this'
  | 'meta'
  | 'deleted'
  | 'nothing'
  | 'literal'
  | 'field'
  | 'bracket'
  | 'index'
  | 'call'
  | 'binary'
  | 'unary'
  | 'if'
  | 'match'
  | 'let'
  | 'object'
  | 'array'
  | 'assign'
  | 'pipe'
  | 'fn'
  | 'dynamic'
  | 'lambda'
  | 'var'

interface ExprData {
  type: ExprType
  value?: string | number | boolean | null
  base?: BloblangExpr
  args?: (BloblangExpr | string | number | boolean | null)[]
  operator?: string
  left?: BloblangExpr
  right?: BloblangExpr
  condition?: BloblangExpr
  consequent?: BloblangExpr
  alternate?: BloblangExpr
  cases?: { pattern: BloblangExpr; body: BloblangExpr }[]
  defaultCase?: BloblangExpr
  fields?: Record<string, BloblangExpr>
  elements?: BloblangExpr[]
  varName?: string
  body?: (v: BloblangExpr) => BloblangExpr
  lambdaBody?: BloblangExpr
  target?: BloblangExpr
  fnName?: string
  fnArgs?: BloblangExpr[]
}

// Helper to check if a string needs bracket notation
function needsBrackets(name: string): boolean {
  // Check for special characters that require bracket notation
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return false
  }
  return true
}

// Helper to escape string for Bloblang
function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}

// Helper to format a value as Bloblang literal
function formatValue(v: string | number | boolean | null | BloblangExpr): string {
  if (v instanceof BloblangExprImpl) {
    return v.toString()
  }
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${escapeString(v)}"`
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

// Check if expression needs parentheses for operator precedence
function needsParens(expr: BloblangExprImpl, context: 'and' | 'or' | 'arith' | 'compare'): boolean {
  const data = expr._data
  if (data.type !== 'binary') return false

  const op = data.operator
  if (context === 'arith') {
    // Arithmetic operations need parens around + and - when used with * / %
    return op === '+' || op === '-'
  }
  return false
}

// The implementation class
class BloblangExprImpl {
  readonly _data: ExprData

  constructor(data: ExprData) {
    this._data = data
  }

  // Convert to Bloblang string
  toString(): string {
    return this._toString()
  }

  _toString(): string {
    const data = this._data

    switch (data.type) {
      case 'root':
        return 'root'
      case 'this':
        return 'this'
      case 'var':
        return data.value as string
      case 'meta':
        if (data.value !== undefined) {
          return `meta("${data.value}")`
        }
        return 'meta()'
      case 'deleted':
        return 'deleted()'
      case 'nothing':
        return 'nothing()'
      case 'literal':
        return formatValue(data.value as string | number | boolean | null)
      case 'field': {
        const base = data.base!._toString()
        const field = data.value as string
        return `${base}.${field}`
      }
      case 'bracket': {
        const base = data.base!._toString()
        const field = data.value as string
        return `${base}["${field}"]`
      }
      case 'index': {
        const base = data.base!._toString()
        const idx = data.value as number
        return `${base}[${idx}]`
      }
      case 'dynamic': {
        const base = data.base!._toString()
        const expr = data.target!._toString()
        return `${base}.(${expr})`
      }
      case 'call': {
        const base = data.base!._toString()
        const method = data.value as string
        const args = data.args || []

        // Handle special lambda methods (map, filter, sort_by, any, all)
        if (['map_each', 'filter', 'sort_by', 'any', 'all'].includes(method) && data.lambdaBody) {
          const lambdaStr = `item -> ${data.lambdaBody._toString()}`
          return `${base}.${method}(${lambdaStr})`
        }

        const formattedArgs = args.map((a) => formatValue(a as string | number | boolean | null | BloblangExpr))
        return `${base}.${method}(${formattedArgs.join(', ')})`
      }
      case 'binary': {
        const op = data.operator!
        const leftExpr = data.left! as BloblangExprImpl
        const rightExpr = data.right!
        let leftStr = leftExpr._toString()
        let rightStr = rightExpr instanceof BloblangExprImpl ? rightExpr._toString() : formatValue(rightExpr as any)

        // Handle operator precedence
        if (op === '*' || op === '/' || op === '%') {
          if (needsParens(leftExpr, 'arith')) {
            leftStr = `(${leftStr})`
          }
        }

        // Logical operators always wrap operands in parens
        if (op === '&&' || op === '||') {
          leftStr = `(${leftStr})`
          rightStr = `(${rightStr})`
        }

        return `${leftStr} ${op} ${rightStr}`
      }
      case 'unary': {
        const op = data.operator!
        const baseData = data.base!._data
        const operand = data.base!._toString()
        if (op === '!') {
          // Wrap binary expressions (comparisons, logical ops) in parentheses
          if (baseData.type === 'binary') {
            return `${op}(${operand})`
          }
          return `${op}${operand}`
        }
        return `${op}${operand}`
      }
      case 'if': {
        const cond = data.condition!._toString()
        const cons = data.consequent!._toString()
        if (data.alternate) {
          const alt = data.alternate._toString()
          return `if ${cond} { ${cons} } else { ${alt} }`
        }
        return `if ${cond} { ${cons} }`
      }
      case 'match': {
        const input = data.base!._toString()
        const caseParts: string[] = []
        for (const c of data.cases || []) {
          caseParts.push(`${c.pattern._toString()} => ${c.body._toString()}`)
        }
        if (data.defaultCase) {
          caseParts.push(`_ => ${data.defaultCase._toString()}`)
        }
        return `match ${input} { ${caseParts.join(', ')} }`
      }
      case 'let': {
        const name = data.varName!
        const value = data.base!._toString()
        const varExpr = new BloblangExprImpl({ type: 'var', value: name })
        const bodyFn = data.body!
        const bodyExpr = bodyFn(varExpr)
        return `let ${name} = ${value}; ${bodyExpr.toString()}`
      }
      case 'object': {
        const fields = data.fields!
        const keys = Object.keys(fields)
        if (keys.length === 0) return '{}'
        const pairs = keys.map((k) => `"${k}": ${fields[k]._toString()}`)
        return `{${pairs.join(', ')}}`
      }
      case 'array': {
        const elements = data.elements!
        if (elements.length === 0) return '[]'
        return `[${elements.map((e) => e._toString()).join(', ')}]`
      }
      case 'assign': {
        const target = data.base!._toString()
        const value = data.target!._toString()
        return `${target} = ${value}`
      }
      case 'pipe': {
        const left = data.left!._toString()
        const right = data.right!._toString()
        return `${left} | ${right}`
      }
      case 'fn': {
        const name = data.fnName!
        const args = data.fnArgs || []
        if (args.length === 0) return `${name}()`
        return `${name}(${args.map((a) => a._toString()).join(', ')})`
      }
      default:
        return ''
    }
  }

  // Generate AST node
  toAST(): ASTNode {
    const data = this._data
    const base = { line: 1, column: 1 }

    switch (data.type) {
      case 'root':
        return { ...base, type: 'Root' }
      case 'this':
        return { ...base, type: 'This' }
      case 'var':
        return { ...base, type: 'Identifier', name: data.value as string }
      case 'meta':
        return { ...base, type: 'Meta' }
      case 'deleted':
        return { ...base, type: 'Deleted' }
      case 'nothing':
        return { ...base, type: 'Nothing' }
      case 'literal': {
        const v = data.value
        let kind: 'string' | 'number' | 'boolean' | 'null'
        if (v === null) kind = 'null'
        else if (typeof v === 'string') kind = 'string'
        else if (typeof v === 'boolean') kind = 'boolean'
        else kind = 'number'
        return { ...base, type: 'Literal', kind, value: v }
      }
      case 'field':
      case 'bracket':
      case 'index':
        return {
          ...base,
          type: 'MemberAccess',
          object: data.base!.toAST(),
          property: data.type === 'index' ? String(data.value) : (data.value as string),
          accessType: data.type === 'bracket' ? 'bracket' : data.type === 'index' ? 'bracket' : 'dot',
        }
      case 'dynamic':
        return {
          ...base,
          type: 'MemberAccess',
          object: data.base!.toAST(),
          property: data.target!.toAST(),
          accessType: 'bracket',
        }
      case 'call': {
        const method = data.value as string
        const fnNode: ASTNode = {
          ...base,
          type: 'MemberAccess',
          object: data.base!.toAST(),
          property: method,
          accessType: 'dot',
        }

        const argNodes: ASTNode[] = []
        if (data.lambdaBody) {
          argNodes.push({
            ...base,
            type: 'Arrow',
            parameter: 'item',
            body: data.lambdaBody.toAST(),
          })
        } else if (data.args) {
          for (const a of data.args) {
            if (a instanceof BloblangExprImpl) {
              argNodes.push(a.toAST())
            } else {
              let kind: 'string' | 'number' | 'boolean' | 'null'
              if (a === null) kind = 'null'
              else if (typeof a === 'string') kind = 'string'
              else if (typeof a === 'boolean') kind = 'boolean'
              else kind = 'number'
              argNodes.push({ ...base, type: 'Literal', kind, value: a })
            }
          }
        }

        return {
          ...base,
          type: 'Call',
          function: fnNode,
          arguments: argNodes,
        }
      }
      case 'binary':
        return {
          ...base,
          type: 'BinaryOp',
          operator: data.operator as any,
          left: data.left!.toAST(),
          right: data.right!.toAST(),
        }
      case 'unary':
        return {
          ...base,
          type: 'UnaryOp',
          operator: data.operator as any,
          operand: data.base!.toAST(),
        }
      case 'if':
        return {
          ...base,
          type: 'If',
          condition: data.condition!.toAST(),
          consequent: data.consequent!.toAST(),
          alternate: data.alternate?.toAST(),
        }
      case 'match': {
        const cases = (data.cases || []).map((c) => ({
          pattern: c.pattern.toAST(),
          body: c.body.toAST(),
        }))
        return {
          ...base,
          type: 'Match',
          input: data.base!.toAST(),
          cases,
          default: data.defaultCase?.toAST(),
        }
      }
      case 'let': {
        const varExpr = new BloblangExprImpl({ type: 'var', value: data.varName })
        const bodyExpr = data.body!(varExpr)
        return {
          ...base,
          type: 'Let',
          name: data.varName!,
          value: data.base!.toAST(),
          body: bodyExpr.toAST(),
        }
      }
      case 'object': {
        const fields = Object.entries(data.fields!).map(([key, value]) => ({
          key,
          value: value.toAST(),
        }))
        return { ...base, type: 'Object', fields }
      }
      case 'array':
        return {
          ...base,
          type: 'Array',
          elements: data.elements!.map((e) => e.toAST()),
        }
      case 'assign':
        return {
          ...base,
          type: 'Assign',
          field: data.base!._toString(),
          value: data.target!.toAST(),
        }
      case 'pipe':
        return {
          ...base,
          type: 'Pipe',
          left: data.left!.toAST(),
          right: data.right!.toAST(),
        }
      case 'fn': {
        const fnIdent: ASTNode = { ...base, type: 'Identifier', name: data.fnName! }
        return {
          ...base,
          type: 'Call',
          function: fnIdent,
          arguments: (data.fnArgs || []).map((a) => a.toAST()),
        }
      }
      default:
        return { ...base, type: 'Literal', kind: 'null', value: null }
    }
  }

  // --- String methods ---
  uppercase(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'uppercase', args: [] })
  }

  lowercase(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'lowercase', args: [] })
  }

  trim(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'trim', args: [] })
  }

  length(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'length', args: [] })
  }

  contains(substr: string | BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'contains', args: [substr] })
  }

  has_prefix(prefix: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'has_prefix', args: [prefix] })
  }

  has_suffix(suffix: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'has_suffix', args: [suffix] })
  }

  replace(old: string, replacement: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'replace', args: [old, replacement] })
  }

  replace_all(old: string, replacement: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'replace_all', args: [old, replacement] })
  }

  split(delimiter: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'split', args: [delimiter] })
  }

  slice(start: number, end?: number): BloblangExpr {
    const args: (string | number | boolean | null)[] = end !== undefined ? [start, end] : [start]
    return new BloblangExprImpl({ type: 'call', base: this, value: 'slice', args })
  }

  // --- Number methods ---
  abs(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'abs', args: [] })
  }

  round(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'round', args: [] })
  }

  floor(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'floor', args: [] })
  }

  ceil(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'ceil', args: [] })
  }

  // --- Arithmetic operations ---
  add(value: number | BloblangExpr): BloblangExpr {
    const right = typeof value === 'number' ? new BloblangExprImpl({ type: 'literal', value }) : value
    return new BloblangExprImpl({ type: 'binary', operator: '+', left: this, right })
  }

  sub(value: number | BloblangExpr): BloblangExpr {
    const right = typeof value === 'number' ? new BloblangExprImpl({ type: 'literal', value }) : value
    return new BloblangExprImpl({ type: 'binary', operator: '-', left: this, right })
  }

  mul(value: number | BloblangExpr): BloblangExpr {
    const right = typeof value === 'number' ? new BloblangExprImpl({ type: 'literal', value }) : value
    return new BloblangExprImpl({ type: 'binary', operator: '*', left: this, right })
  }

  div(value: number | BloblangExpr): BloblangExpr {
    const right = typeof value === 'number' ? new BloblangExprImpl({ type: 'literal', value }) : value
    return new BloblangExprImpl({ type: 'binary', operator: '/', left: this, right })
  }

  mod(value: number | BloblangExpr): BloblangExpr {
    const right = typeof value === 'number' ? new BloblangExprImpl({ type: 'literal', value }) : value
    return new BloblangExprImpl({ type: 'binary', operator: '%', left: this, right })
  }

  negate(): BloblangExpr {
    return new BloblangExprImpl({ type: 'unary', operator: '-', base: this })
  }

  // --- Comparison operations ---
  eq(value: string | number | boolean | null | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '==', left: this, right })
  }

  neq(value: string | number | boolean | null | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '!=', left: this, right })
  }

  gt(value: number | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '>', left: this, right })
  }

  gte(value: number | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '>=', left: this, right })
  }

  lt(value: number | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '<', left: this, right })
  }

  lte(value: number | BloblangExpr): BloblangExpr {
    const right = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'binary', operator: '<=', left: this, right })
  }

  // --- Logical operations ---
  and(other: BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'binary', operator: '&&', left: this, right: other })
  }

  or(other: BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'binary', operator: '||', left: this, right: other })
  }

  not(): BloblangExpr {
    return new BloblangExprImpl({ type: 'unary', operator: '!', base: this })
  }

  // --- Array methods ---
  map(fn: (item: BloblangExpr) => BloblangExpr): BloblangExpr {
    const itemProxy = createFieldProxy(new BloblangExprImpl({ type: 'var', value: 'item' }))
    const bodyExpr = fn(itemProxy)
    return new BloblangExprImpl({ type: 'call', base: this, value: 'map_each', args: [], lambdaBody: bodyExpr as BloblangExprImpl })
  }

  filter(fn: (item: BloblangExpr) => BloblangExpr): BloblangExpr {
    const itemProxy = createFieldProxy(new BloblangExprImpl({ type: 'var', value: 'item' }))
    const bodyExpr = fn(itemProxy)
    return new BloblangExprImpl({ type: 'call', base: this, value: 'filter', args: [], lambdaBody: bodyExpr as BloblangExprImpl })
  }

  flatten(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'flatten', args: [] })
  }

  first(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'first', args: [] })
  }

  last(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'last', args: [] })
  }

  sort(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'sort', args: [] })
  }

  sort_by(fn: (item: BloblangExpr) => BloblangExpr): BloblangExpr {
    const itemProxy = createFieldProxy(new BloblangExprImpl({ type: 'var', value: 'item' }))
    const bodyExpr = fn(itemProxy)
    return new BloblangExprImpl({ type: 'call', base: this, value: 'sort_by', args: [], lambdaBody: bodyExpr as BloblangExprImpl })
  }

  reverse(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'reverse', args: [] })
  }

  unique(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'unique', args: [] })
  }

  append(value: string | number | boolean | null | BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'append', args: [value] })
  }

  concat(other: BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'concat', args: [other] })
  }

  any(fn: (item: BloblangExpr) => BloblangExpr): BloblangExpr {
    const itemProxy = createFieldProxy(new BloblangExprImpl({ type: 'var', value: 'item' }))
    const bodyExpr = fn(itemProxy)
    return new BloblangExprImpl({ type: 'call', base: this, value: 'any', args: [], lambdaBody: bodyExpr as BloblangExprImpl })
  }

  all(fn: (item: BloblangExpr) => BloblangExpr): BloblangExpr {
    const itemProxy = createFieldProxy(new BloblangExprImpl({ type: 'var', value: 'item' }))
    const bodyExpr = fn(itemProxy)
    return new BloblangExprImpl({ type: 'call', base: this, value: 'all', args: [], lambdaBody: bodyExpr as BloblangExprImpl })
  }

  join(delimiter: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'join', args: [delimiter] })
  }

  index(idx: number): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'index', args: [idx] })
  }

  sum(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'sum', args: [] })
  }

  // --- Object methods ---
  keys(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'keys', args: [] })
  }

  values(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'values', args: [] })
  }

  merge(other: BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'merge', args: [other] })
  }

  without(keys: string[]): BloblangExpr {
    // Format as array literal in toString
    const keysExpr = new BloblangExprImpl({
      type: 'array',
      elements: keys.map((k) => new BloblangExprImpl({ type: 'literal', value: k })),
    })
    return new BloblangExprImpl({ type: 'call', base: this, value: 'without', args: [keysExpr] })
  }

  exists(key: string): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'exists', args: [key] })
  }

  // --- Type conversion ---
  string(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'string', args: [] })
  }

  number(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'number', args: [] })
  }

  int(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'int', args: [] })
  }

  bool(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'bool', args: [] })
  }

  type(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'type', args: [] })
  }

  from_json(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'from_json', args: [] })
  }

  to_json(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'to_json', args: [] })
  }

  parse_json(): BloblangExpr {
    return new BloblangExprImpl({ type: 'call', base: this, value: 'parse_json', args: [] })
  }

  // --- Assignment ---
  set(value: string | number | boolean | null | BloblangExpr): BloblangExpr {
    const valueExpr = value instanceof BloblangExprImpl ? value : new BloblangExprImpl({ type: 'literal', value })
    return new BloblangExprImpl({ type: 'assign', base: this, target: valueExpr })
  }

  // --- Dynamic field access ---
  get(expr: BloblangExpr): BloblangExpr {
    return createFieldProxy(new BloblangExprImpl({ type: 'dynamic', base: this, target: expr as BloblangExprImpl }))
  }

  // --- Pipe ---
  pipe(fn: BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({ type: 'pipe', left: this, right: fn as BloblangExprImpl })
  }
}

// Methods that can never be field names - these always return the bound method
const RESERVED_METHODS = new Set([
  // Internal
  '_data', '_toString', 'toString', 'toAST',
  // Operators - these don't make sense as field names
  'add', 'sub', 'mul', 'div', 'mod', 'negate',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'and', 'or', 'not',
  // Assignment/access
  'set', 'get', 'pipe',
  // String transformations - these are clearly method calls
  'uppercase', 'lowercase', 'trim', 'has_prefix', 'has_suffix',
  'replace', 'replace_all', 'parse_json', 'from_json', 'to_json',
  // Array transformations
  'map', 'filter', 'flatten', 'sort_by', 'reverse', 'unique',
  'append', 'concat', 'any', 'all', 'join', 'sum',
  // Object methods
  'merge', 'without', 'exists',
  // Number methods
  'abs', 'round', 'floor', 'ceil',
])

// Methods that could also be field names - need dual behavior
const DUAL_PURPOSE_METHODS = new Set([
  'index', 'type', 'string', 'number', 'int', 'bool',
  'length', 'keys', 'values', 'first', 'last', 'sort',
  'contains', 'split', 'slice',
])

// Create a callable proxy for methods that could also be field names
// When called as a function, acts as the method on the ORIGINAL base
// When accessed for a property, acts as a field accessor on the field expression
function createDualProxy(baseExpr: BloblangExprImpl, fieldExpr: BloblangExprImpl, methodFn: Function): BloblangExpr {
  const fn = function (...args: any[]) {
    // Call the method on the original base, not the field expression
    return methodFn.apply(baseExpr, args)
  }

  return new Proxy(fn as any, {
    get(_target, prop, _receiver) {
      // Handle symbol properties
      if (typeof prop === 'symbol') {
        return undefined
      }

      const name = prop as string

      // When accessing any property on this dual-purpose thing,
      // treat it as field access and return methods from the field expression
      return createExprProxy(fieldExpr)[name]
    },
    apply(_target, _thisArg, args) {
      // Call the method on the original base, not the field expression
      return methodFn.apply(baseExpr, args)
    },
  }) as BloblangExpr
}

// Create a proxy that allows field access via dot, bracket notation, and numeric indexes
function createExprProxy(base: BloblangExprImpl): BloblangExpr {
  return new Proxy(base, {
    get(target, prop, receiver) {
      // Handle symbol properties first
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }

      const name = prop as string

      // Handle internal properties
      if (name === '_data' || name === '_toString') {
        return Reflect.get(target, prop, receiver)
      }

      // For reserved methods that can never be field names
      if (RESERVED_METHODS.has(name) && typeof (target as any)[name] === 'function') {
        return (target as any)[name].bind(target)
      }

      // For dual-purpose methods (can be field or method)
      // Create a field expression, but return something that can also be called as the method
      if (DUAL_PURPOSE_METHODS.has(name)) {
        const fieldExpr = new BloblangExprImpl({ type: 'field', base: target, value: name })
        const methodFn = (target as any)[name]
        if (typeof methodFn === 'function') {
          return createDualProxy(target, fieldExpr, methodFn)
        }
        return createExprProxy(fieldExpr)
      }

      // Handle numeric index access (including negative numbers like "-1")
      const numIndex = Number(name)
      if (!isNaN(numIndex) && name === String(numIndex)) {
        return createExprProxy(new BloblangExprImpl({ type: 'index', base: target, value: numIndex }))
      }

      // For valid identifier names, create field access
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        return createExprProxy(new BloblangExprImpl({ type: 'field', base: target, value: name }))
      }

      // For special characters (like 'field-with-dash'), use bracket notation
      return createExprProxy(new BloblangExprImpl({ type: 'bracket', base: target, value: name }))
    },
  }) as BloblangExpr
}

// Alias for backward compatibility
const createFieldProxy = createExprProxy

// If expression builder
interface IfBuilder {
  then(consequent: BloblangExpr): IfThenBuilder
}

interface IfThenBuilder extends BloblangExpr {
  else(alternate: BloblangExpr): BloblangExpr
}

// Create a proxy specifically for IfThenBuilder that includes the else method
function createIfThenProxy(
  condition: BloblangExprImpl,
  consequent: BloblangExprImpl,
  expr: BloblangExprImpl,
): IfThenBuilder {
  return new Proxy(expr, {
    get(target, prop, receiver) {
      // Handle the special 'else' method
      if (prop === 'else') {
        return (alternate: BloblangExpr) => {
          return new BloblangExprImpl({
            type: 'if',
            condition,
            consequent,
            alternate: alternate as BloblangExprImpl,
          })
        }
      }

      // Handle symbol properties first
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }

      const name = prop as string

      // Handle internal properties
      if (name === '_data' || name === '_toString') {
        return Reflect.get(target, prop, receiver)
      }

      // For reserved methods that can never be field names
      if (RESERVED_METHODS.has(name) && typeof (target as any)[name] === 'function') {
        return (target as any)[name].bind(target)
      }

      // For dual-purpose methods (can be field or method)
      if (DUAL_PURPOSE_METHODS.has(name)) {
        const fieldExpr = new BloblangExprImpl({ type: 'field', base: target, value: name })
        const methodFn = (target as any)[name]
        if (typeof methodFn === 'function') {
          return createDualProxy(target, fieldExpr, methodFn)
        }
        return createExprProxy(fieldExpr)
      }

      // Handle numeric index access
      const numIndex = Number(name)
      if (!isNaN(numIndex) && name === String(numIndex)) {
        return createExprProxy(new BloblangExprImpl({ type: 'index', base: target, value: numIndex }))
      }

      // For valid identifier names, create field access
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        return createExprProxy(new BloblangExprImpl({ type: 'field', base: target, value: name }))
      }

      // For special characters, use bracket notation
      return createExprProxy(new BloblangExprImpl({ type: 'bracket', base: target, value: name }))
    },
  }) as IfThenBuilder
}

function createIfBuilder(condition: BloblangExpr): IfBuilder {
  return {
    then(consequent: BloblangExpr): IfThenBuilder {
      const expr = new BloblangExprImpl({
        type: 'if',
        condition: condition as BloblangExprImpl,
        consequent: consequent as BloblangExprImpl,
      })
      return createIfThenProxy(
        condition as BloblangExprImpl,
        consequent as BloblangExprImpl,
        expr,
      )
    },
  }
}

// Match expression builder
interface MatchBuilder {
  case(pattern: BloblangExpr, body: BloblangExpr): MatchBuilder
  default(body: BloblangExpr): BloblangExpr
  toString(): string
  toAST(): ASTNode
}

function createMatchBuilder(input: BloblangExpr, cases: { pattern: BloblangExpr; body: BloblangExpr }[] = []): MatchBuilder {
  const expr = new BloblangExprImpl({
    type: 'match',
    base: input as BloblangExprImpl,
    cases: cases.map((c) => ({ pattern: c.pattern as BloblangExprImpl, body: c.body as BloblangExprImpl })),
  })

  return {
    case(pattern: BloblangExpr, body: BloblangExpr): MatchBuilder {
      return createMatchBuilder(input, [...cases, { pattern, body }])
    },
    default(body: BloblangExpr): BloblangExpr {
      return new BloblangExprImpl({
        type: 'match',
        base: input as BloblangExprImpl,
        cases: cases.map((c) => ({ pattern: c.pattern as BloblangExprImpl, body: c.body as BloblangExprImpl })),
        defaultCase: body as BloblangExprImpl,
      })
    },
    toString() {
      return expr.toString()
    },
    toAST() {
      return expr.toAST()
    },
  }
}

// The exported BloblangExpr type - use interface merging for extensibility
export interface BloblangExpr extends BloblangExprImpl {
  // Allow arbitrary property access for field chaining
  [key: string]: any
}

// The main $ proxy
interface BloblangDSL {
  root: BloblangExpr
  this: BloblangExpr
  meta(key?: string): BloblangExpr
  deleted(): BloblangExpr
  nothing(): BloblangExpr
  literal(value: string | number | boolean | null): BloblangExpr
  object(fields: Record<string, BloblangExpr>): BloblangExpr
  array(elements: BloblangExpr[]): BloblangExpr
  if(condition: BloblangExpr): IfBuilder
  match(input: BloblangExpr): MatchBuilder
  let(name: string, value: BloblangExpr, body: (v: BloblangExpr) => BloblangExpr): BloblangExpr
  fn(name: string, args?: BloblangExpr[]): BloblangExpr
}

export const $: BloblangDSL = {
  get root(): BloblangExpr {
    return createExprProxy(new BloblangExprImpl({ type: 'root' }))
  },

  get this(): BloblangExpr {
    return createExprProxy(new BloblangExprImpl({ type: 'this' }))
  },

  meta(key?: string): BloblangExpr {
    return createFieldProxy(new BloblangExprImpl({ type: 'meta', value: key }))
  },

  deleted(): BloblangExpr {
    return new BloblangExprImpl({ type: 'deleted' })
  },

  nothing(): BloblangExpr {
    return new BloblangExprImpl({ type: 'nothing' })
  },

  literal(value: string | number | boolean | null): BloblangExpr {
    return new BloblangExprImpl({ type: 'literal', value })
  },

  object(fields: Record<string, BloblangExpr>): BloblangExpr {
    const exprFields: Record<string, BloblangExprImpl> = {}
    for (const [k, v] of Object.entries(fields)) {
      exprFields[k] = v as BloblangExprImpl
    }
    return new BloblangExprImpl({ type: 'object', fields: exprFields })
  },

  array(elements: BloblangExpr[]): BloblangExpr {
    return new BloblangExprImpl({
      type: 'array',
      elements: elements.map((e) => e as BloblangExprImpl),
    })
  },

  if(condition: BloblangExpr): IfBuilder {
    return createIfBuilder(condition)
  },

  match(input: BloblangExpr): MatchBuilder {
    return createMatchBuilder(input)
  },

  let(name: string, value: BloblangExpr, body: (v: BloblangExpr) => BloblangExpr): BloblangExpr {
    return new BloblangExprImpl({
      type: 'let',
      varName: name,
      base: value as BloblangExprImpl,
      body,
    })
  },

  fn(name: string, args?: BloblangExpr[]): BloblangExpr {
    return new BloblangExprImpl({
      type: 'fn',
      fnName: name,
      fnArgs: args?.map((a) => a as BloblangExprImpl),
    })
  },
}
