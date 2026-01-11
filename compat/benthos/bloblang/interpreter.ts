/**
 * GREEN Phase Implementation: Bloblang Interpreter
 * Issue: dotdo-xd5fx
 *
 * Evaluates Bloblang AST nodes against input data (BenthosMessage).
 *
 * REFACTOR: Decomposed into submodules (Issue: dotdo-h5ix3)
 * - PipeEvaluator: Handles pipe expression evaluation
 * - ContextManager: Handles variable scope and context management
 */

import type {
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
} from './ast'

/**
 * Special symbols for Bloblang values
 */
export const DELETED = Symbol.for('bloblang.deleted')
export const NOTHING = Symbol.for('bloblang.nothing')
import { BenthosMessage } from '../core/message'
import { PipeEvaluator, type PipeEvaluatorContext } from './interpreter/PipeEvaluator'
import { ContextManager, type InterpreterContext as ContextManagerContext } from './interpreter/ContextManager'
import { stringFunctions } from './stdlib/string'
import * as arrayFunctions from './stdlib/array'
import * as numberFunctions from './stdlib/number'
import * as objectFunctions from './stdlib/object'
import * as typeFunctions from './stdlib/type'
import type { FunctionRegistry } from './registry'
import { getGlobalRegistry } from './registry'

/**
 * Interpreter options
 */
export interface InterpreterOptions {
  registry?: FunctionRegistry
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Find similar function names for "did you mean" suggestions
 */
function findSimilarNames(name: string, candidates: string[], maxDistance = 3): string[] {
  return candidates
    .map(candidate => ({ name: candidate, distance: levenshteinDistance(name, candidate) }))
    .filter(item => item.distance <= maxDistance && item.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(item => item.name)
}

/**
 * Type name helper for error messages
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Validate that a value is a number for arithmetic operations
 */
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
  // Use "cannot" phrasing for multiply/divide to match test expectations
  throw new TypeError(`Cannot ${operation}, expected number, got ${typeName}`)
}

/**
 * Validate that a value is a string for string methods
 */
function requireString(value: unknown, methodName: string): string {
  if (typeof value === 'string') return value
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} expects a string, got ${typeName}`)
}

/**
 * Validate that a value is an array for array methods
 */
function requireArray(value: unknown, methodName: string): unknown[] {
  if (Array.isArray(value)) return value
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} expects an array, got ${typeName}`)
}

/**
 * Validate that a value is a plain object for object methods
 */
function requireObject(value: unknown, methodName: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  const typeName = getTypeName(value)
  throw new TypeError(`${methodName} requires an object, got ${typeName}`)
}

/**
 * Check if values are comparable for ordering operators
 */
function validateComparable(left: unknown, right: unknown, _op: string): void {
  const leftType = getTypeName(left)
  const rightType = getTypeName(right)

  // Only numbers and strings of the same type are orderable
  const isLeftOrderable = typeof left === 'number' || typeof left === 'string'
  const isRightOrderable = typeof right === 'number' || typeof right === 'string'

  if (!isLeftOrderable || !isRightOrderable) {
    throw new TypeError(`Cannot compare ${leftType} with ${rightType}`)
  }

  // Types must match for ordering comparisons
  if (typeof left !== typeof right) {
    throw new TypeError(`Cannot compare ${leftType} with ${rightType}`)
  }
}

/**
 * Interpreter context holding message and variable bindings
 */
export interface InterpreterContext {
  message: BenthosMessage
  variables: Map<string, unknown>
  pipeValue?: unknown // Value being piped through
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

/**
 * Arrow function representation for use as values
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
  private registry: FunctionRegistry
  private pipeEvaluator: PipeEvaluator
  private contextManager: ContextManager

  constructor(message?: BenthosMessage, options?: InterpreterOptions) {
    this.context = createInterpreterContext(message)
    this.registry = options?.registry ?? getGlobalRegistry()
    this.pipeEvaluator = new PipeEvaluator()
    this.contextManager = new ContextManager()
  }

  /**
   * Evaluate an AST node and return the result
   */
  evaluate(ast: ASTNode): unknown {
    return this.evalNode(ast, this.context)
  }

  /**
   * Internal evaluation with context
   */
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
        // Map nodes are typically used as method calls
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

    // Check if it's the pipe placeholder
    if (name === '_' && ctx.pipeValue !== undefined) {
      return ctx.pipeValue
    }

    // Check for $varname reference (local variable)
    if (name.startsWith('$')) {
      const varName = name.slice(1) // Remove the $ prefix
      if (ctx.variables.has(varName)) {
        return ctx.variables.get(varName)
      }
      // Also check with $ prefix (for env vars or explicit $ vars)
      if (ctx.variables.has(name)) {
        return ctx.variables.get(name)
      }
      return undefined
    }

    // Check local variables first
    if (ctx.variables.has(name)) {
      return ctx.variables.get(name)
    }

    // Check if it's a property on root
    const result = ctx.message.jsonSafe()
    const root = result !== undefined ? result : ctx.message.content
    if (root && typeof root === 'object' && name in (root as Record<string, unknown>)) {
      return (root as Record<string, unknown>)[name]
    }

    // Return undefined for unknown identifiers
    return undefined
  }

  private evalRoot(_node: RootNode, ctx: InterpreterContext): unknown {
    // Use jsonSafe to handle non-JSON content gracefully
    const result = ctx.message.jsonSafe()
    if (result === undefined) {
      // If content isn't valid JSON, return the raw string
      return ctx.message.content
    }
    return result
  }

  private evalThis(_node: ThisNode, ctx: InterpreterContext): unknown {
    // Use jsonSafe to handle non-JSON content gracefully
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

    // Short-circuit evaluation for logical operators
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

    // Evaluate both sides for other operators
    const left = this.evalNode(node.left, ctx)
    const right = this.evalNode(node.right, ctx)

    switch (op) {
      case '+':
        // String concatenation if either operand is a string (and the other is a valid concat type)
        if (typeof left === 'string' || typeof right === 'string') {
          // Allow string + string, string + number, number + string
          if ((typeof left === 'string' || typeof left === 'number') &&
              (typeof right === 'string' || typeof right === 'number')) {
            return String(left) + String(right)
          }
          // Reject array, object, boolean, null in string concatenation
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
        // Validate types for arithmetic addition
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
        // Membership check: value in array
        if (Array.isArray(right)) {
          return right.includes(left)
        }
        // For objects, check if key exists
        if (typeof right === 'object' && right !== null) {
          return String(left) in (right as Record<string, unknown>)
        }
        return false
      default:
        throw new Error(`Unknown binary operator: ${op}`)
    }
  }

  private looseEquals(left: unknown, right: unknown): boolean {
    // Treat undefined and null as equal (Bloblang semantics)
    if ((left === undefined || left === null) && (right === undefined || right === null)) {
      return true
    }

    // Same type comparison
    if (typeof left === typeof right) {
      return left === right
    }

    // String to number coercion
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
        // Type validation for unary negation
        const typeName = getTypeName(operand)
        if (typeof operand !== 'number') {
          throw new TypeError(`Cannot negate ${typeName}, got ${typeName}`)
        }
        const negated = -operand
        // Normalize -0 to 0
        return negated === 0 ? 0 : negated
      case '!':
        return !this.isTruthy(operand)
      default:
        throw new Error(`Unknown unary operator: ${node.operator}`)
    }
  }

  private evalMemberAccess(node: MemberAccessNode, ctx: InterpreterContext): unknown {
    const object = this.evalNode(node.object, ctx)

    // Handle null/undefined access
    if (object === null || object === undefined) {
      if (node.accessType === 'optional') {
        return undefined
      }
      return undefined
    }

    // Get property name
    let propName: string | number | unknown
    if (typeof node.property === 'string') {
      propName = node.property
    } else {
      propName = this.evalNode(node.property, ctx)
    }

    // Access the property
    if (Array.isArray(object)) {
      // For bracket access on arrays, validate index type
      if (node.accessType === 'bracket') {
        if (typeof propName !== 'number' && typeof propName !== 'string') {
          throw new TypeError(`array index must be a number, got ${getTypeName(propName)}`)
        }
        // Non-numeric strings are not valid array indices
        if (typeof propName === 'string' && !/^\d+$/.test(propName)) {
          throw new TypeError(`array index must be a number, got string`)
        }
      }
      if (typeof propName === 'number') {
        // Support negative indexing
        if (propName < 0) {
          return object[object.length + propName]
        }
        return object[propName]
      }
      // Array property access (like 'length')
      if (propName === 'length') {
        return object.length
      }
      // Try numeric string
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

    // Handle deleted() and nothing() as special functions
    if (node.function.type === 'Deleted') {
      return DELETED
    }
    if (node.function.type === 'Nothing') {
      return NOTHING
    }

    // Handle meta() calls
    if (node.function.type === 'Meta') {
      if (args.length === 0) {
        return ctx.message.metadata.toObject()
      }
      return ctx.message.metadata.get(String(args[0]))
    }

    // Handle method calls (e.g., "hello".uppercase())
    if (node.function.type === 'MemberAccess') {
      const memberAccess = node.function as MemberAccessNode
      const target = this.evalNode(memberAccess.object, ctx)
      const methodName = typeof memberAccess.property === 'string'
        ? memberAccess.property
        : String(this.evalNode(memberAccess.property, ctx))

      // For array methods that need lambdas, pass AST nodes if not arrow functions
      if (Array.isArray(target) && ['map', 'filter', 'reduce'].includes(methodName)) {
        return this.callArrayMethodWithAST(target, methodName, node.arguments, args, ctx)
      }

      return this.callMethod(target, methodName, args, ctx)
    }

    // Handle direct function calls (e.g., length("hello"))
    if (node.function.type === 'Identifier') {
      const funcName = (node.function as IdentifierNode).name
      return this.callFunction(funcName, args, ctx)
    }

    // Handle calling an arrow function value
    const funcValue = this.evalNode(node.function, ctx)
    if (funcValue instanceof ArrowFunction) {
      return this.callArrowFunction(funcValue, args, ctx)
    }

    throw new Error(`Cannot call non-function value`)
  }

  private callMethod(target: unknown, method: string, args: unknown[], ctx: InterpreterContext): unknown {
    // REFACTOR: Lambda-requiring methods need interpreter handling, not registry
    // Check for these before the registry to ensure proper lambda evaluation
    const lambdaRequiringMethods = ['map', 'filter', 'reduce']
    if (Array.isArray(target) && lambdaRequiringMethods.includes(method)) {
      return this.callArrayMethod(target, method, args, ctx)
    }

    // Check registry for other methods - allows custom methods to override built-in type restrictions
    const targetType = this.getTypeForRegistry(target)
    if (targetType) {
      const registeredMethod = this.registry.getMethod(targetType, method)
      if (registeredMethod) {
        return registeredMethod.call(target, ...args)
      }
    }

    // Define which methods belong exclusively to which type
    const stringOnlyMethods = ['uppercase', 'upper', 'lowercase', 'lower', 'trim', 'replace',
      'replace_all', 'split', 'substring', 'has_prefix', 'has_suffix']
    const sharedStringArrayMethods = ['slice', 'contains', 'length']
    // Note: map, filter, reduce are included for error message purposes even though
    // they're handled specially above when target is an array
    const arrayOnlyMethods = ['map', 'filter', 'reduce', 'join', 'reverse', 'sort', 'first', 'last',
      'flatten', 'unique', 'append', 'concat', 'index', 'sum']
    const objectOnlyMethods = ['keys', 'values']

    // Check for string-only methods on wrong types
    if (stringOnlyMethods.includes(method) && typeof target !== 'string') {
      requireString(target, method)
    }

    // Check for shared string/array methods on wrong types
    if (sharedStringArrayMethods.includes(method) && typeof target !== 'string' && !Array.isArray(target)) {
      const typeName = getTypeName(target)
      throw new TypeError(`${method} expects a string or array, got ${typeName}`)
    }

    // Check for array-only methods on wrong types
    if (arrayOnlyMethods.includes(method) && !Array.isArray(target)) {
      requireArray(target, method)
    }

    // Check for object-only methods (reject arrays and non-objects)
    if (objectOnlyMethods.includes(method)) {
      requireObject(target, method)
    }

    // String methods
    if (typeof target === 'string') {
      return this.callStringMethod(target, method, args)
    }

    // Array methods
    if (Array.isArray(target)) {
      return this.callArrayMethod(target, method, args, ctx)
    }

    // Object methods
    if (typeof target === 'object' && target !== null) {
      return this.callObjectMethod(target as Record<string, unknown>, method, args)
    }

    throw new TypeError(`Cannot call method '${method}' on ${getTypeName(target)}`)
  }

  private callStringMethod(str: string, method: string, args: unknown[]): unknown {
    // Check registry first for custom methods
    const registeredMethod = this.registry.getMethod('string', method)
    if (registeredMethod) {
      return registeredMethod.call(str, ...args)
    }

    // Built-in string methods
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
      default: {
        // Unknown method - provide helpful error with suggestions
        const knownMethods = ['uppercase', 'upper', 'lowercase', 'lower', 'length', 'trim',
          'replace', 'replace_all', 'split', 'substring', 'slice', 'contains',
          'has_prefix', 'has_suffix', ...this.registry.listMethods('string')]
        const suggestions = findSimilarNames(method, knownMethods)
        let errorMsg = `Unknown method '${method}' on string`
        if (suggestions.length > 0) {
          errorMsg += `. Did you mean: ${suggestions.join(', ')}?`
        }
        throw new Error(errorMsg)
      }
    }
  }

  private callArrayMethod(arr: unknown[], method: string, args: unknown[], ctx: InterpreterContext): unknown {
    // REFACTOR: Special methods that need interpreter-level lambda evaluation
    // These cannot be fully delegated to the registry
    switch (method) {
      case 'map':
        return this.mapArray(arr, args[0], ctx)
      case 'filter':
        return this.filterArray(arr, args[0], ctx)
      case 'reduce':
        return this.reduceArray(arr, args[0], args[1], ctx)
    }

    // REFACTOR: Use registry for all other array method dispatch
    // Registry methods include proper type validation
    const registeredMethod = this.registry.getMethod('array', method)
    if (registeredMethod) {
      return registeredMethod.call(arr, ...args)
    }

    // Unknown method - provide helpful error with suggestions
    const knownMethods = this.registry.listMethods('array')
    const suggestions = findSimilarNames(method, knownMethods)
    let errorMsg = `Unknown method '${method}' on array`
    if (suggestions.length > 0) {
      errorMsg += `. Did you mean: ${suggestions.join(', ')}?`
    }
    throw new Error(errorMsg)
  }

  private callObjectMethod(obj: Record<string, unknown>, method: string, args: unknown[]): unknown {
    // REFACTOR: Use registry for all object method dispatch
    const registeredMethod = this.registry.getMethod('object', method)
    if (registeredMethod) {
      return registeredMethod.call(obj, ...args)
    }

    // Unknown method - provide helpful error with suggestions
    const knownMethods = this.registry.listMethods('object')
    const suggestions = findSimilarNames(method, knownMethods)
    let errorMsg = `Unknown method '${method}' on object`
    if (suggestions.length > 0) {
      errorMsg += `. Did you mean: ${suggestions.join(', ')}?`
    }
    throw new Error(errorMsg)
  }

  private callFunction(name: string, args: unknown[], _ctx: InterpreterContext): unknown {
    // REFACTOR: Non-overridable special functions that need interpreter context
    switch (name) {
      // Special values (symbols) - cannot be overridden
      case 'deleted':
        return DELETED
      case 'nothing':
        return NOTHING

      // Time functions (runtime-dependent) - cannot be overridden
      case 'now':
        return new Date().toISOString()
      case 'timestamp_unix':
        return Math.floor(Date.now() / 1000)

      // UUID functions (runtime-dependent) - cannot be overridden
      case 'uuid_v4':
      case '$uuid':
        return this.generateUUID()

      // Metadata functions (needs interpreter context) - cannot be overridden
      case 'meta':
        if (args.length === 0) {
          return _ctx.message.metadata.toObject()
        }
        return _ctx.message.metadata.get(String(args[0]))
    }

    // REFACTOR: Use registry for all other function dispatch
    // Registry functions include proper type validation
    const registeredFn = this.registry.get(name)
    if (registeredFn) {
      return registeredFn(...args)
    }

    // Unknown function - provide helpful error with suggestions
    const knownFunctions = this.registry.listFunctions()
    const suggestions = findSimilarNames(name, knownFunctions)
    let errorMsg = `Unknown function: ${name}`
    if (suggestions.length > 0) {
      errorMsg += `. Did you mean: ${suggestions.join(', ')}?`
    }
    throw new Error(errorMsg)
  }

  /**
   * Handle array methods that need to receive AST nodes for lambdas
   */
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
    // If the evaluated arg is already an ArrowFunction, use it
    if (evaluatedArg instanceof ArrowFunction) {
      return arr.map((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(evaluatedArg.parameter, elem)
        return this.evalNode(evaluatedArg.body, newCtx)
      })
    }

    // Otherwise, use the AST node directly, treating 'this' as the current element
    return arr.map((elem, _idx) => {
      const newCtx = this.createChildContext(ctx)
      // Create a temporary message with the element as root for 'this' reference
      const elemMsg = new BenthosMessage(elem, ctx.message.metadata.toObject())
      newCtx.message = elemMsg
      return this.evalNode(astArg, newCtx)
    })
  }

  private filterArrayWithAST(arr: unknown[], astArg: ASTNode, evaluatedArg: unknown, ctx: InterpreterContext): unknown[] {
    // If the evaluated arg is already an ArrowFunction, use it
    if (evaluatedArg instanceof ArrowFunction) {
      return arr.filter((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(evaluatedArg.parameter, elem)
        const result = this.evalNode(evaluatedArg.body, newCtx)
        return this.isTruthy(result)
      })
    }

    // Otherwise, use the AST node directly, treating 'this' as the current element
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

  /**
   * Evaluate pipe expression - delegates to PipeEvaluator submodule
   */
  private evalPipe(node: PipeNode, ctx: InterpreterContext): unknown {
    // Create the context for PipeEvaluator with callbacks to interpreter methods
    const pipeCtx: PipeEvaluatorContext = {
      message: ctx.message,
      variables: ctx.variables,
      evalNode: (n: ASTNode) => this.evalNode(n, ctx),
      callMethod: (target: unknown, method: string, args: unknown[]) =>
        this.callMethod(target, method, args, ctx),
      callFunction: (name: string, args: unknown[]) =>
        this.callFunction(name, args, ctx),
    }

    return this.pipeEvaluator.evaluate(node, pipeCtx)
  }

  /**
   * Check if a method name is a valid pipe method for the given value
   * Delegates to PipeEvaluator submodule
   */
  private isPipeMethod(value: unknown, method: string): boolean {
    return this.pipeEvaluator.isPipeMethod(value, method)
  }

  /**
   * Call a method on a piped value
   */
  private callPipeMethod(value: unknown, method: string, args: unknown[], ctx: InterpreterContext): unknown {
    // Try calling as a method on the value
    if (typeof value === 'string') {
      if (method === 'length') return value.length
      return this.callStringMethod(value, method, args)
    }
    if (Array.isArray(value)) {
      if (method === 'length') return value.length
      return this.callArrayMethod(value, method, args, ctx)
    }
    if (typeof value === 'object' && value !== null) {
      return this.callObjectMethod(value as Record<string, unknown>, method, args)
    }
    // Fall back to global functions
    return this.callFunction(method, [value, ...args], ctx)
  }

  private evalArrow(node: ArrowNode, ctx: InterpreterContext): ArrowFunction {
    return new ArrowFunction(node.parameter, node.body, ctx)
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
    // Generate random bytes
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    // Set version (4) in the 7th byte, bits 12-15
    bytes[6] = (bytes[6] & 0x0f) | 0x40

    // Set variant (10xx) in the 9th byte, bits 6-7
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    // Convert to hex string with dashes
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }

  /**
   * Evaluate a sequence of statements, returning the result of the last one
   */
  private evalSequence(node: SequenceNode, ctx: InterpreterContext): unknown {
    let result: unknown = undefined
    for (const statement of node.statements) {
      result = this.evalNode(statement, ctx)
    }
    return result
  }

  /**
   * Evaluate an assignment, modifying the message and returning the assigned value
   */
  private evalAssign(node: AssignNode, ctx: InterpreterContext): unknown {
    const value = this.evalNode(node.value, ctx)
    const field = node.field

    // Handle variable assignment ($varname = value)
    if (field.startsWith('$')) {
      const varName = field.slice(1) // Remove the $ prefix
      ctx.variables.set(varName, value)
      return value
    }

    // Handle root assignment
    if (field === 'root') {
      ctx.message.root = value
      return value
    }

    // Handle root.field assignment
    if (field.startsWith('root.')) {
      const path = field.slice(5) // Remove 'root.'
      this.setNestedValue(ctx.message.root, path, value)
      return value
    }

    // Handle meta("key") assignment
    if (field.startsWith('meta("') && field.endsWith('")')) {
      const key = field.slice(6, -2) // Extract key from meta("key")
      if (value === DELETED) {
        ctx.message.metadata.delete(key)
      } else {
        ctx.message.metadata.set(key, String(value))
      }
      return value
    }

    // Handle simple field assignment (treated as root.field)
    this.setNestedValue(ctx.message.root, field, value)
    return value
  }

  /**
   * Set a nested value in an object using dot notation path
   */
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

  /**
   * Get the registry type name for a value
   */
  private getTypeForRegistry(value: unknown): string | null {
    if (typeof value === 'string') return 'string'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'object' && value !== null) return 'object'
    return null
  }
}

/**
 * Evaluate an AST node against a BenthosMessage
 */
export function evaluate(ast: ASTNode, message: BenthosMessage): unknown {
  const interpreter = new Interpreter(message)
  return interpreter.evaluate(ast)
}
