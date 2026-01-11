/**
 * GREEN Phase Implementation: Bloblang Interpreter
 * Issue: dotdo-xd5fx
 *
 * Evaluates Bloblang AST nodes against input data (BenthosMessage).
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
import { stringFunctions } from './stdlib/string'
import * as arrayFunctions from './stdlib/array'
import * as numberFunctions from './stdlib/number'
import * as objectFunctions from './stdlib/object'
import * as typeFunctions from './stdlib/type'

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

  constructor(message?: BenthosMessage) {
    this.context = createInterpreterContext(message)
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

    // Check local variables first
    if (ctx.variables.has(name)) {
      return ctx.variables.get(name)
    }

    // Check if it's a property on root
    const root = ctx.message.root as Record<string, unknown>
    if (root && typeof root === 'object' && name in root) {
      return root[name]
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
        // String concatenation if either operand is a string
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right)
        }
        return (left as number) + (right as number)
      case '-':
        return (left as number) - (right as number)
      case '*':
        return (left as number) * (right as number)
      case '/':
        return (left as number) / (right as number)
      case '%':
        return (left as number) % (right as number)
      case '==':
        return this.looseEquals(left, right)
      case '!=':
        return !this.looseEquals(left, right)
      case '<':
        return (left as number | string) < (right as number | string)
      case '>':
        return (left as number | string) > (right as number | string)
      case '<=':
        return (left as number | string) <= (right as number | string)
      case '>=':
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
        const negated = -(operand as number)
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
    let propName: string | number
    if (typeof node.property === 'string') {
      propName = node.property
    } else {
      const propValue = this.evalNode(node.property, ctx)
      propName = propValue as string | number
    }

    // Access the property
    if (Array.isArray(object)) {
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

    throw new Error(`Cannot call method '${method}' on ${typeof target}`)
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
        throw new Error(`Unknown string method: ${method}`)
    }
  }

  private callArrayMethod(arr: unknown[], method: string, args: unknown[], ctx: InterpreterContext): unknown {
    switch (method) {
      case 'length':
        return arr.length
      case 'map':
        return this.mapArray(arr, args[0], ctx)
      case 'filter':
        return this.filterArray(arr, args[0], ctx)
      case 'reduce':
        return this.reduceArray(arr, args[0], args[1], ctx)
      case 'join':
        return arr.join(String(args[0] ?? ','))
      case 'reverse':
        return [...arr].reverse()
      case 'sort':
        return arrayFunctions.sort.call(arr)
      case 'first':
        return arrayFunctions.first.call(arr)
      case 'last':
        return arrayFunctions.last.call(arr)
      case 'flatten':
        return arrayFunctions.flatten.call(arr)
      case 'unique':
        return arrayFunctions.unique.call(arr)
      case 'contains':
        return arrayFunctions.contains.call(arr, args[0])
      case 'append':
        return arrayFunctions.append.call(arr, args[0])
      case 'concat':
        return arrayFunctions.concat.call(arr, args[0] as unknown[])
      case 'slice':
        return arrayFunctions.slice.call(arr, args[0] as number, args[1] as number | undefined)
      case 'index':
        return arrayFunctions.index.call(arr, args[0] as number)
      case 'sum':
        return numberFunctions.sum(arr as number[])
      default:
        throw new Error(`Unknown array method: ${method}`)
    }
  }

  private callObjectMethod(obj: Record<string, unknown>, method: string, _args: unknown[]): unknown {
    switch (method) {
      case 'keys':
        return objectFunctions.keys(obj)
      case 'values':
        return objectFunctions.values(obj)
      default:
        throw new Error(`Unknown object method: ${method}`)
    }
  }

  private callFunction(name: string, args: unknown[], _ctx: InterpreterContext): unknown {
    // Global functions
    switch (name) {
      // Type functions
      case 'type':
        return typeFunctions.type.call(args[0])
      case 'string':
        return typeFunctions.string.call(args[0])
      case 'int':
        return typeFunctions.int.call(args[0])
      case 'float':
        return typeFunctions.float.call(args[0])
      case 'bool':
        return typeFunctions.bool.call(args[0])
      case 'array':
        return typeFunctions.array.call(args[0])
      case 'object':
        return typeFunctions.object.call(args[0])

      // JSON conversion functions
      case 'from_json':
      case 'parse_json':
        return JSON.parse(String(args[0]))
      case 'to_json':
        return JSON.stringify(args[0])
      case 'number':
        return Number(args[0])

      // String functions
      case 'length':
        if (typeof args[0] === 'string') {
          return stringFunctions.length.call(args[0])
        }
        if (Array.isArray(args[0])) {
          return args[0].length
        }
        throw new Error('length() requires string or array')
      case 'uppercase':
        return stringFunctions.uppercase.call(args[0])
      case 'lowercase':
        return stringFunctions.lowercase.call(args[0])
      case 'substring':
        return stringFunctions.slice.call(args[0], args[1], args[2])
      case 'replace':
        return stringFunctions.replace.call(args[0], args[1], args[2])

      // Number functions
      case 'abs':
        return numberFunctions.abs(args[0] as number)
      case 'ceil':
        return numberFunctions.ceil(args[0] as number)
      case 'floor':
        return numberFunctions.floor(args[0] as number)
      case 'round':
        return numberFunctions.round(args[0] as number)
      case 'max':
        return numberFunctions.max(args[0] as number, args[1] as number)
      case 'min':
        return numberFunctions.min(args[0] as number, args[1] as number)
      case 'sum':
        return numberFunctions.sum(args[0] as number[])

      // Object functions
      case 'keys':
        return objectFunctions.keys(args[0])
      case 'values':
        return objectFunctions.values(args[0])
      case 'entries':
        const obj = args[0] as Record<string, unknown>
        return Object.entries(obj)
      case 'merge':
        return objectFunctions.merge(args[0], args[1])
      case 'without':
        return objectFunctions.without(args[0], args[1] as string[])
      case 'exists':
        return objectFunctions.exists(args[0], args[1] as string)
      case 'get':
        return objectFunctions.get(args[0], args[1] as string, args[2])
      case 'set':
        return objectFunctions.set(args[0], args[1] as string, args[2])

      // Special values
      case 'deleted':
        return DELETED
      case 'nothing':
        return NOTHING

      // Time functions
      case 'now':
        return new Date().toISOString()
      case 'timestamp_unix':
        return Math.floor(Date.now() / 1000)

      // UUID functions
      case 'uuid_v4':
      case '$uuid':
        return this.generateUUID()

      // Metadata functions
      case 'meta':
        if (args.length === 0) {
          return _ctx.message.metadata.toObject()
        }
        return _ctx.message.metadata.get(String(args[0]))

      default:
        throw new Error(`Unknown function: ${name}`)
    }
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

  private evalPipe(node: PipeNode, ctx: InterpreterContext): unknown {
    // Evaluate left side first
    const leftValue = this.evalNode(node.left, ctx)

    // Create context with pipe value for the right side
    const pipeCtx = this.createChildContext(ctx)
    pipeCtx.pipeValue = leftValue

    // If right side is a Call, inject left value as first argument or as target
    if (node.right.type === 'Call') {
      const callNode = node.right as CallNode

      // Check if this is a method call on _ (the pipe value)
      if (callNode.function.type === 'MemberAccess') {
        const memberAccess = callNode.function as MemberAccessNode
        if (memberAccess.object.type === 'Identifier' &&
            (memberAccess.object as IdentifierNode).name === '_') {
          // Replace _ with the actual pipe value and call the method
          const methodName = typeof memberAccess.property === 'string'
            ? memberAccess.property
            : String(this.evalNode(memberAccess.property, pipeCtx))
          const args = callNode.arguments.map(arg => this.evalNode(arg, pipeCtx))
          return this.callMethod(leftValue, methodName, args, pipeCtx)
        }
      }

      // Direct function call - try calling as a method on the piped value first
      if (callNode.function.type === 'Identifier') {
        const funcName = (callNode.function as IdentifierNode).name
        const args = callNode.arguments.map(arg => this.evalNode(arg, pipeCtx))
        // Try as method on the piped value first
        try {
          return this.callMethod(leftValue, funcName, args, pipeCtx)
        } catch {
          // Fall back to global function
          return this.callFunction(funcName, [leftValue, ...args], pipeCtx)
        }
      }
    }

    // Check if right side is a member access on _
    if (node.right.type === 'MemberAccess') {
      const memberAccess = node.right as MemberAccessNode
      if (memberAccess.object.type === 'Identifier' &&
          (memberAccess.object as IdentifierNode).name === '_') {
        // This is accessing a property/method on the piped value
        const propName = typeof memberAccess.property === 'string'
          ? memberAccess.property
          : String(this.evalNode(memberAccess.property, pipeCtx))

        // Check if it's a method call
        if (typeof leftValue === 'string') {
          // String method with no args
          return this.callStringMethod(leftValue, propName, [])
        }
        if (Array.isArray(leftValue)) {
          if (propName === 'length') return leftValue.length
          return this.callArrayMethod(leftValue, propName, [], pipeCtx)
        }
      }
    }

    // If right side is a bare identifier (like `| length`), treat it as a method call
    if (node.right.type === 'Identifier') {
      const methodName = (node.right as IdentifierNode).name
      return this.callPipeMethod(leftValue, methodName, [], pipeCtx)
    }

    // If right side is a BinaryOp with an Identifier on the left (like `| length > 2`),
    // resolve the identifier as a method call on the piped value first
    if (node.right.type === 'BinaryOp') {
      const binOp = node.right as BinaryOpNode
      if (binOp.left.type === 'Identifier') {
        const methodName = (binOp.left as IdentifierNode).name
        // Check if this is a known method that should be called on the pipe value
        if (this.isPipeMethod(leftValue, methodName)) {
          const methodResult = this.callPipeMethod(leftValue, methodName, [], pipeCtx)
          const rightResult = this.evalNode(binOp.right, pipeCtx)
          return this.evalBinaryOpValues(binOp.operator, methodResult, rightResult)
        }
      }
    }

    // Otherwise, just evaluate right side with pipe context
    return this.evalNode(node.right, pipeCtx)
  }

  /**
   * Check if a method name is a valid pipe method for the given value
   */
  private isPipeMethod(value: unknown, method: string): boolean {
    // Common methods that can be called via pipe
    const pipeableMethods = ['length', 'contains', 'uppercase', 'lowercase', 'upper', 'lower',
      'trim', 'split', 'join', 'reverse', 'sort', 'first', 'last', 'flatten', 'unique', 'sum',
      'keys', 'values', 'type', 'string', 'number', 'bool', 'int', 'float']
    return pipeableMethods.includes(method)
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

  /**
   * Evaluate a binary operation with already-evaluated values
   */
  private evalBinaryOpValues(op: string, left: unknown, right: unknown): unknown {
    switch (op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right)
        }
        return (left as number) + (right as number)
      case '-':
        return (left as number) - (right as number)
      case '*':
        return (left as number) * (right as number)
      case '/':
        return (left as number) / (right as number)
      case '%':
        return (left as number) % (right as number)
      case '==':
        return this.looseEquals(left, right)
      case '!=':
        return !this.looseEquals(left, right)
      case '<':
        return (left as number | string) < (right as number | string)
      case '>':
        return (left as number | string) > (right as number | string)
      case '<=':
        return (left as number | string) <= (right as number | string)
      case '>=':
        return (left as number | string) >= (right as number | string)
      case '&&':
        return this.isTruthy(left) && this.isTruthy(right) ? right : left
      case '||':
        return this.isTruthy(left) ? left : right
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
}

/**
 * Evaluate an AST node against a BenthosMessage
 */
export function evaluate(ast: ASTNode, message: BenthosMessage): unknown {
  const interpreter = new Interpreter(message)
  return interpreter.evaluate(ast)
}
