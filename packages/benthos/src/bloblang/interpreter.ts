/**
 * Bloblang Interpreter
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Evaluates Bloblang AST nodes against BenthosMessage data.
 */

import type {
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
  SequenceNode,
} from './ast'

import { BenthosMessage } from '../message'
import { stringFunctions } from './stdlib/string'
import * as arrayFunctions from './stdlib/array'
import * as numberFunctions from './stdlib/number'
import * as objectFunctions from './stdlib/object'
import * as typeFunctions from './stdlib/type'

/**
 * Special symbols for Bloblang values
 */
export const DELETED = Symbol.for('bloblang.deleted')
export const NOTHING = Symbol.for('bloblang.nothing')

/**
 * Interpreter context
 */
export interface InterpreterContext {
  message: BenthosMessage
  variables: Map<string, unknown>
  pipeValue?: unknown
}

/**
 * Create a new interpreter context
 */
export function createInterpreterContext(message?: BenthosMessage): InterpreterContext {
  return {
    message: message ?? new BenthosMessage({}),
    variables: new Map(),
  }
}

function getTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function requireNumber(value: unknown, operation: string): number {
  if (typeof value === 'number') return value
  const typeName = getTypeName(value)
  if (value === null) {
    throw new TypeError(`Cannot perform arithmetic on null, got null`)
  }
  if (Array.isArray(value)) {
    throw new TypeError(`Cannot perform arithmetic on array, got array`)
  }
  if (typeof value === 'object' && value !== null) {
    throw new TypeError(`Cannot perform arithmetic on object, got object`)
  }
  if (typeof value === 'boolean') {
    throw new TypeError(`Cannot ${operation} boolean, got boolean`)
  }
  throw new TypeError(`Cannot ${operation}, expected number, got ${typeName}`)
}

function requireString(value: unknown, methodName: string): string {
  if (typeof value === 'string') return value
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} expects a string, got ${typeName}`)
}

function requireArray(value: unknown, methodName: string): unknown[] {
  if (Array.isArray(value)) return value
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} expects an array, got ${typeName}`)
}

function requireObject(value: unknown, methodName: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} requires an object, got ${typeName}`)
}

function validateComparable(left: unknown, right: unknown, _op: string): void {
  const leftType = getTypeName(left)
  const rightType = getTypeName(right)

  const isLeftOrderable = typeof left === 'number' || typeof left === 'string'
  const isRightOrderable = typeof right === 'number' || typeof right === 'string'

  if (!isLeftOrderable || !isRightOrderable) {
    throw new TypeError(`Cannot compare ${leftType} with ${rightType}`)
  }

  if (typeof left !== typeof right) {
    throw new TypeError(`Cannot compare ${leftType} with ${rightType}`)
  }
}

/**
 * Arrow function representation
 */
class ArrowFunction {
  constructor(
    public parameter: string,
    public body: ASTNode,
    public capturedContext: InterpreterContext
  ) {}
}

/**
 * Bloblang Interpreter
 */
export class Interpreter {
  private context: InterpreterContext

  constructor(message?: BenthosMessage) {
    this.context = createInterpreterContext(message)
  }

  evaluate(ast: ASTNode): unknown {
    return this.evalNode(ast, this.context)
  }

  private evalNode(node: ASTNode, ctx: InterpreterContext): unknown {
    switch (node.type) {
      case 'Literal':
        return this.evalLiteral(node)
      case 'Identifier':
        return this.evalIdentifier(node, ctx)
      case 'Root':
        return this.evalRoot(node, ctx)
      case 'This':
        return this.evalThis(node, ctx)
      case 'Meta':
        return this.evalMeta(node, ctx)
      case 'Deleted':
        return DELETED
      case 'Nothing':
        return NOTHING
      case 'BinaryOp':
        return this.evalBinaryOp(node, ctx)
      case 'UnaryOp':
        return this.evalUnaryOp(node, ctx)
      case 'MemberAccess':
        return this.evalMemberAccess(node, ctx)
      case 'Call':
        return this.evalCall(node, ctx)
      case 'Array':
        return this.evalArray(node, ctx)
      case 'Object':
        return this.evalObject(node, ctx)
      case 'If':
        return this.evalIf(node, ctx)
      case 'Match':
        return this.evalMatch(node, ctx)
      case 'Let':
        return this.evalLet(node, ctx)
      case 'Pipe':
        return this.evalPipe(node, ctx)
      case 'Arrow':
        return this.evalArrow(node, ctx)
      case 'Map':
        return undefined
      case 'Assign':
        return this.evalAssign(node as AssignNode, ctx)
      case 'Sequence':
        return this.evalSequence(node as SequenceNode, ctx)
      default:
        throw new Error(`Unknown node type: ${(node as ASTNode).type}`)
    }
  }

  private evalLiteral(node: LiteralNode): unknown {
    return node.value
  }

  private evalIdentifier(node: IdentifierNode, ctx: InterpreterContext): unknown {
    const name = node.name

    if (name === '_' && ctx.pipeValue !== undefined) {
      return ctx.pipeValue
    }

    if (name.startsWith('$')) {
      const varName = name.slice(1)
      if (ctx.variables.has(varName)) {
        return ctx.variables.get(varName)
      }
      if (ctx.variables.has(name)) {
        return ctx.variables.get(name)
      }
      return undefined
    }

    if (ctx.variables.has(name)) {
      return ctx.variables.get(name)
    }

    const result = ctx.message.jsonSafe()
    const root = result !== undefined ? result : ctx.message.content
    if (root && typeof root === 'object' && name in (root as Record<string, unknown>)) {
      return (root as Record<string, unknown>)[name]
    }

    return undefined
  }

  private evalRoot(_node: RootNode, ctx: InterpreterContext): unknown {
    const result = ctx.message.jsonSafe()
    if (result === undefined) {
      return ctx.message.content
    }
    return result
  }

  private evalThis(_node: ThisNode, ctx: InterpreterContext): unknown {
    const result = ctx.message.jsonSafe()
    if (result === undefined) {
      return ctx.message.content
    }
    return result
  }

  private evalMeta(_node: MetaNode, ctx: InterpreterContext): unknown {
    return ctx.message.metadata.toObject()
  }

  private evalBinaryOp(node: BinaryOpNode, ctx: InterpreterContext): unknown {
    const op = node.operator

    if (op === '&&') {
      const left = this.evalNode(node.left, ctx)
      if (!this.isTruthy(left)) {
        return left
      }
      return this.evalNode(node.right, ctx)
    }

    if (op === '||') {
      const left = this.evalNode(node.left, ctx)
      if (this.isTruthy(left)) {
        return left
      }
      return this.evalNode(node.right, ctx)
    }

    const left = this.evalNode(node.left, ctx)
    const right = this.evalNode(node.right, ctx)

    switch (op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          if ((typeof left === 'string' || typeof left === 'number') &&
              (typeof right === 'string' || typeof right === 'number')) {
            return String(left) + String(right)
          }
          if (Array.isArray(left) || Array.isArray(right)) {
            throw new TypeError(`Cannot perform arithmetic on array, got array`)
          }
          if ((typeof left === 'object' && left !== null) || (typeof right === 'object' && right !== null)) {
            throw new TypeError(`Cannot perform arithmetic on object, got object`)
          }
          if (typeof left === 'boolean' || typeof right === 'boolean') {
            throw new TypeError(`Cannot add boolean, got boolean`)
          }
          if (left === null || right === null) {
            throw new TypeError(`Cannot perform arithmetic on null, got null`)
          }
        }
        requireNumber(left, 'add')
        requireNumber(right, 'add')
        return (left as number) + (right as number)
      case '-':
        requireNumber(left, 'subtract')
        requireNumber(right, 'subtract')
        return (left as number) - (right as number)
      case '*':
        requireNumber(left, 'multiply')
        requireNumber(right, 'multiply')
        return (left as number) * (right as number)
      case '/':
        requireNumber(left, 'divide')
        requireNumber(right, 'divide')
        return (left as number) / (right as number)
      case '%':
        requireNumber(left, 'modulo')
        requireNumber(right, 'modulo')
        return (left as number) % (right as number)
      case '==':
        return this.looseEquals(left, right)
      case '!=':
        return !this.looseEquals(left, right)
      case '<':
        validateComparable(left, right, '<')
        return (left as number | string) < (right as number | string)
      case '>':
        validateComparable(left, right, '>')
        return (left as number | string) > (right as number | string)
      case '<=':
        validateComparable(left, right, '<=')
        return (left as number | string) <= (right as number | string)
      case '>=':
        validateComparable(left, right, '>=')
        return (left as number | string) >= (right as number | string)
      case 'in':
        if (Array.isArray(right)) {
          return right.includes(left)
        }
        if (typeof right === 'object' && right !== null) {
          return String(left) in (right as Record<string, unknown>)
        }
        return false
      default:
        throw new Error(`Unknown binary operator: ${op}`)
    }
  }

  private looseEquals(left: unknown, right: unknown): boolean {
    if ((left === undefined || left === null) && (right === undefined || right === null)) {
      return true
    }

    if (typeof left === typeof right) {
      return left === right
    }

    if (typeof left === 'string' && typeof right === 'number') {
      return Number(left) === right
    }
    if (typeof left === 'number' && typeof right === 'string') {
      return left === Number(right)
    }

    return left === right
  }

  private evalUnaryOp(node: UnaryOpNode, ctx: InterpreterContext): unknown {
    const operand = this.evalNode(node.operand, ctx)

    switch (node.operator) {
      case '-':
        const typeName = getTypeName(operand)
        if (typeof operand !== 'number') {
          throw new TypeError(`Cannot negate ${typeName}, got ${typeName}`)
        }
        const negated = -operand
        return negated === 0 ? 0 : negated
      case '!':
        return !this.isTruthy(operand)
      default:
        throw new Error(`Unknown unary operator: ${node.operator}`)
    }
  }

  private evalMemberAccess(node: MemberAccessNode, ctx: InterpreterContext): unknown {
    const object = this.evalNode(node.object, ctx)

    if (object === null || object === undefined) {
      if (node.accessType === 'optional') {
        return undefined
      }
      return undefined
    }

    let propName: string | number | unknown
    if (typeof node.property === 'string') {
      propName = node.property
    } else {
      propName = this.evalNode(node.property, ctx)
    }

    if (Array.isArray(object)) {
      if (node.accessType === 'bracket') {
        if (typeof propName !== 'number' && typeof propName !== 'string') {
          throw new TypeError(`array index must be a number, got ${getTypeName(propName)}`)
        }
        if (typeof propName === 'string' && !/^\d+$/.test(propName)) {
          throw new TypeError(`array index must be a number, got string`)
        }
      }
      if (typeof propName === 'number') {
        if (propName < 0) {
          return object[object.length + propName]
        }
        return object[propName]
      }
      if (propName === 'length') {
        return object.length
      }
      if (typeof propName === 'string' && /^\d+$/.test(propName)) {
        return object[parseInt(propName, 10)]
      }
    }

    if (typeof object === 'object' && object !== null) {
      return (object as Record<string, unknown>)[propName as string]
    }

    return undefined
  }

  private evalCall(node: CallNode, ctx: InterpreterContext): unknown {
    const args = node.arguments.map(arg => this.evalNode(arg, ctx))

    if (node.function.type === 'Deleted') {
      return DELETED
    }
    if (node.function.type === 'Nothing') {
      return NOTHING
    }

    if (node.function.type === 'Meta') {
      if (args.length === 0) {
        return ctx.message.metadata.toObject()
      }
      return ctx.message.metadata.get(String(args[0]))
    }

    if (node.function.type === 'MemberAccess') {
      const memberAccess = node.function as MemberAccessNode
      const target = this.evalNode(memberAccess.object, ctx)
      const methodName = typeof memberAccess.property === 'string'
        ? memberAccess.property
        : String(this.evalNode(memberAccess.property, ctx))

      if (Array.isArray(target) && ['map', 'filter', 'reduce'].includes(methodName)) {
        return this.callArrayMethodWithAST(target, methodName, node.arguments, args, ctx)
      }

      return this.callMethod(target, methodName, args, ctx)
    }

    if (node.function.type === 'Identifier') {
      const funcName = (node.function as IdentifierNode).name
      return this.callFunction(funcName, args, ctx)
    }

    const funcValue = this.evalNode(node.function, ctx)
    if (funcValue instanceof ArrowFunction) {
      return this.callArrowFunction(funcValue, args, ctx)
    }

    throw new Error(`Cannot call non-function value`)
  }

  private callMethod(target: unknown, method: string, args: unknown[], ctx: InterpreterContext): unknown {
    const lambdaRequiringMethods = ['map', 'filter', 'reduce']
    if (Array.isArray(target) && lambdaRequiringMethods.includes(method)) {
      return this.callArrayMethod(target, method, args, ctx)
    }

    const stringOnlyMethods = ['uppercase', 'upper', 'lowercase', 'lower', 'trim', 'replace',
      'replace_all', 'split', 'substring', 'has_prefix', 'has_suffix']
    const sharedStringArrayMethods = ['slice', 'contains', 'length']
    const arrayOnlyMethods = ['map', 'filter', 'reduce', 'join', 'reverse', 'sort', 'first', 'last',
      'flatten', 'unique', 'append', 'concat', 'index', 'sum']
    const objectOnlyMethods = ['keys', 'values']

    if (stringOnlyMethods.includes(method) && typeof target !== 'string') {
      requireString(target, method)
    }

    if (sharedStringArrayMethods.includes(method) && typeof target !== 'string' && !Array.isArray(target)) {
      const typeName = getTypeName(target)
      throw new TypeError(`${method} expects a string or array, got ${typeName}`)
    }

    if (arrayOnlyMethods.includes(method) && !Array.isArray(target)) {
      requireArray(target, method)
    }

    if (objectOnlyMethods.includes(method)) {
      requireObject(target, method)
    }

    if (typeof target === 'string') {
      return this.callStringMethod(target, method, args)
    }

    if (Array.isArray(target)) {
      return this.callArrayMethod(target, method, args, ctx)
    }

    if (typeof target === 'object' && target !== null) {
      return this.callObjectMethod(target as Record<string, unknown>, method, args)
    }

    throw new TypeError(`Cannot call method '${method}' on ${getTypeName(target)}`)
  }

  private callStringMethod(str: string, method: string, args: unknown[]): unknown {
    switch (method) {
      case 'uppercase':
      case 'upper':
        return stringFunctions.uppercase.call(str)
      case 'lowercase':
      case 'lower':
        return stringFunctions.lowercase.call(str)
      case 'length':
        return stringFunctions.length.call(str)
      case 'trim':
        return stringFunctions.trim.call(str)
      case 'replace':
        return stringFunctions.replace.call(str, args[0], args[1])
      case 'replace_all':
        return stringFunctions.replace_all.call(str, args[0], args[1])
      case 'split':
        return stringFunctions.split.call(str, args[0])
      case 'substring':
      case 'slice':
        return stringFunctions.slice.call(str, args[0], args[1])
      case 'contains':
        return stringFunctions.contains.call(str, args[0])
      case 'has_prefix':
        return stringFunctions.has_prefix.call(str, args[0])
      case 'has_suffix':
        return stringFunctions.has_suffix.call(str, args[0])
      default:
        throw new Error(`Unknown method '${method}' on string`)
    }
  }

  private callArrayMethod(arr: unknown[], method: string, args: unknown[], ctx: InterpreterContext): unknown {
    switch (method) {
      case 'map':
        return this.mapArray(arr, args[0], ctx)
      case 'filter':
        return this.filterArray(arr, args[0], ctx)
      case 'reduce':
        return this.reduceArray(arr, args[0], args[1], ctx)
      case 'length':
        return arr.length
      case 'first':
        return arr[0]
      case 'last':
        return arr[arr.length - 1]
      case 'join':
        return arr.join(String(args[0] ?? ','))
      case 'flatten':
        return arr.flat()
      case 'unique':
        return [...new Set(arr)]
      case 'sum':
        return arr.reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0)
      case 'append':
        return [...arr, args[0]]
      case 'concat':
        return [...arr, ...(Array.isArray(args[0]) ? args[0] : [args[0]])]
      case 'slice':
        return arr.slice(args[0] as number, args[1] as number)
      case 'contains':
        return arr.includes(args[0])
      case 'reverse':
        return [...arr].reverse()
      case 'sort':
        return [...arr].sort()
      case 'index':
        return arr.indexOf(args[0])
      default:
        throw new Error(`Unknown method '${method}' on array`)
    }
  }

  private callObjectMethod(obj: Record<string, unknown>, method: string, args: unknown[]): unknown {
    switch (method) {
      case 'keys':
        return Object.keys(obj)
      case 'values':
        return Object.values(obj)
      default:
        throw new Error(`Unknown method '${method}' on object`)
    }
  }

  private callFunction(name: string, args: unknown[], ctx: InterpreterContext): unknown {
    switch (name) {
      case 'deleted':
        return DELETED
      case 'nothing':
        return NOTHING
      case 'now':
        return new Date().toISOString()
      case 'timestamp_unix':
        return Math.floor(Date.now() / 1000)
      case 'uuid_v4':
      case '$uuid':
        return this.generateUUID()
      case 'meta':
        if (args.length === 0) {
          return ctx.message.metadata.toObject()
        }
        return ctx.message.metadata.get(String(args[0]))
      case 'length':
        if (typeof args[0] === 'string') return (args[0] as string).length
        if (Array.isArray(args[0])) return args[0].length
        return 0
      case 'throw':
        throw new Error(String(args[0] ?? 'error'))
      default:
        throw new Error(`Unknown function: ${name}`)
    }
  }

  private callArrayMethodWithAST(arr: unknown[], method: string, astArgs: ASTNode[], evaluatedArgs: unknown[], ctx: InterpreterContext): unknown {
    switch (method) {
      case 'map':
        return this.mapArrayWithAST(arr, astArgs[0], evaluatedArgs[0], ctx)
      case 'filter':
        return this.filterArrayWithAST(arr, astArgs[0], evaluatedArgs[0], ctx)
      case 'reduce':
        return this.reduceArray(arr, evaluatedArgs[0], evaluatedArgs[1], ctx)
      default:
        throw new Error(`Unknown array method: ${method}`)
    }
  }

  private mapArrayWithAST(arr: unknown[], astArg: ASTNode, evaluatedArg: unknown, ctx: InterpreterContext): unknown[] {
    if (evaluatedArg instanceof ArrowFunction) {
      return arr.map((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(evaluatedArg.parameter, elem)
        return this.evalNode(evaluatedArg.body, newCtx)
      })
    }

    return arr.map((elem, _idx) => {
      const newCtx = this.createChildContext(ctx)
      const elemMsg = new BenthosMessage(elem, ctx.message.metadata.toObject())
      newCtx.message = elemMsg
      return this.evalNode(astArg, newCtx)
    })
  }

  private filterArrayWithAST(arr: unknown[], astArg: ASTNode, evaluatedArg: unknown, ctx: InterpreterContext): unknown[] {
    if (evaluatedArg instanceof ArrowFunction) {
      return arr.filter((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(evaluatedArg.parameter, elem)
        const result = this.evalNode(evaluatedArg.body, newCtx)
        return this.isTruthy(result)
      })
    }

    return arr.filter((elem, _idx) => {
      const newCtx = this.createChildContext(ctx)
      const elemMsg = new BenthosMessage(elem, ctx.message.metadata.toObject())
      newCtx.message = elemMsg
      const result = this.evalNode(astArg, newCtx)
      return this.isTruthy(result)
    })
  }

  private mapArray(arr: unknown[], mapperArg: unknown, ctx: InterpreterContext): unknown[] {
    if (mapperArg instanceof ArrowFunction) {
      return arr.map((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(mapperArg.parameter, elem)
        return this.evalNode(mapperArg.body, newCtx)
      })
    }
    throw new Error('map() requires a lambda function (use x -> expr syntax)')
  }

  private filterArray(arr: unknown[], predicateArg: unknown, ctx: InterpreterContext): unknown[] {
    if (predicateArg instanceof ArrowFunction) {
      return arr.filter((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(predicateArg.parameter, elem)
        const result = this.evalNode(predicateArg.body, newCtx)
        return this.isTruthy(result)
      })
    }
    throw new Error('filter() requires a lambda function')
  }

  private reduceArray(arr: unknown[], reducerArg: unknown, initial: unknown, ctx: InterpreterContext): unknown {
    if (reducerArg instanceof ArrowFunction) {
      return arr.reduce((acc, _elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(reducerArg.parameter, acc)
        return this.evalNode(reducerArg.body, newCtx)
      }, initial)
    }
    throw new Error('reduce() requires a lambda function')
  }

  private callArrowFunction(fn: ArrowFunction, args: unknown[], _ctx: InterpreterContext): unknown {
    const newCtx = this.createChildContext(fn.capturedContext)
    if (args.length > 0) {
      newCtx.variables.set(fn.parameter, args[0])
    }
    return this.evalNode(fn.body, newCtx)
  }

  private evalArray(node: ArrayNode, ctx: InterpreterContext): unknown[] {
    return node.elements.map(elem => this.evalNode(elem, ctx))
  }

  private evalObject(node: ObjectNode, ctx: InterpreterContext): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const field of node.fields) {
      result[field.key] = this.evalNode(field.value, ctx)
    }
    return result
  }

  private evalIf(node: IfNode, ctx: InterpreterContext): unknown {
    const condition = this.evalNode(node.condition, ctx)
    if (this.isTruthy(condition)) {
      return this.evalNode(node.consequent, ctx)
    }
    if (node.alternate) {
      return this.evalNode(node.alternate, ctx)
    }
    return undefined
  }

  private evalMatch(node: MatchNode, ctx: InterpreterContext): unknown {
    const input = this.evalNode(node.input, ctx)

    for (const matchCase of node.cases) {
      const pattern = this.evalNode(matchCase.pattern, ctx)
      if (this.looseEquals(input, pattern)) {
        return this.evalNode(matchCase.body, ctx)
      }
    }

    if (node.default) {
      return this.evalNode(node.default, ctx)
    }

    return undefined
  }

  private evalLet(node: LetNode, ctx: InterpreterContext): unknown {
    const value = this.evalNode(node.value, ctx)
    const newCtx = this.createChildContext(ctx)
    newCtx.variables.set(node.name, value)
    return this.evalNode(node.body, newCtx)
  }

  private evalPipe(node: PipeNode, ctx: InterpreterContext): unknown {
    const leftValue = this.evalNode(node.left, ctx)

    const pipeCtx = this.createChildContext(ctx)
    pipeCtx.pipeValue = leftValue

    // For call nodes, inject the piped value
    if (node.right.type === 'Call') {
      const callNode = node.right as CallNode
      if (callNode.function.type === 'Identifier') {
        const funcName = (callNode.function as IdentifierNode).name
        const args = callNode.arguments.map(arg => this.evalNode(arg, pipeCtx))
        return this.callMethod(leftValue, funcName, args, pipeCtx)
      }
    }

    return this.evalNode(node.right, pipeCtx)
  }

  private evalArrow(node: ArrowNode, ctx: InterpreterContext): ArrowFunction {
    return new ArrowFunction(node.parameter, node.body, ctx)
  }

  private evalSequence(node: SequenceNode, ctx: InterpreterContext): unknown {
    let result: unknown = undefined
    for (const statement of node.statements) {
      result = this.evalNode(statement, ctx)
    }
    return result
  }

  private evalAssign(node: AssignNode, ctx: InterpreterContext): unknown {
    const value = this.evalNode(node.value, ctx)
    const field = node.field

    if (field.startsWith('$')) {
      const varName = field.slice(1)
      ctx.variables.set(varName, value)
      return value
    }

    if (field === 'root') {
      ctx.message.root = value
      return value
    }

    if (field.startsWith('root.')) {
      const path = field.slice(5)
      this.setNestedValue(ctx.message.root, path, value)
      return value
    }

    if (field.startsWith('meta("') && field.endsWith('")')) {
      const key = field.slice(6, -2)
      if (value === DELETED) {
        ctx.message.metadata.delete(key)
      } else {
        ctx.message.metadata.set(key, String(value))
      }
      return value
    }

    this.setNestedValue(ctx.message.root, field, value)
    return value
  }

  private setNestedValue(obj: unknown, path: string, value: unknown): void {
    if (typeof obj !== 'object' || obj === null) {
      return
    }

    const parts = path.split('.')
    let current = obj as Record<string, unknown>

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]
    if (value === DELETED) {
      delete current[lastPart]
    } else {
      current[lastPart] = value
    }
  }

  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    return true
  }

  private createChildContext(parent: InterpreterContext): InterpreterContext {
    return {
      message: parent.message,
      variables: new Map(parent.variables),
      pipeValue: parent.pipeValue,
    }
  }

  private generateUUID(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }
}

export function evaluate(ast: ASTNode, message: BenthosMessage): unknown {
  const interpreter = new Interpreter(message)
  return interpreter.evaluate(ast)
}
