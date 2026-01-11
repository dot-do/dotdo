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
} from './ast'
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
        // Assign nodes are for mappings, not expressions
        return undefined
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
    return ctx.message.root
  }

  private evalThis(_node: ThisNode, ctx: InterpreterContext): unknown {
    return ctx.message.root
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
      default:
        throw new Error(`Unknown binary operator: ${op}`)
    }
  }

  private looseEquals(left: unknown, right: unknown): boolean {
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

    // Handle method calls (e.g., "hello".uppercase())
    if (node.function.type === 'MemberAccess') {
      const memberAccess = node.function as MemberAccessNode
      const target = this.evalNode(memberAccess.object, ctx)
      const methodName = typeof memberAccess.property === 'string'
        ? memberAccess.property
        : String(this.evalNode(memberAccess.property, ctx))

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
        return stringFunctions.uppercase.call(str)
      case 'lowercase':
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

      // Time functions
      case 'now':
        return Date.now()

      default:
        throw new Error(`Unknown function: ${name}`)
    }
  }

  private mapArray(arr: unknown[], mapperArg: unknown, ctx: InterpreterContext): unknown[] {
    if (mapperArg instanceof ArrowFunction) {
      return arr.map((elem, _idx) => {
        const newCtx = this.createChildContext(ctx)
        newCtx.variables.set(mapperArg.parameter, elem)
        return this.evalNode(mapperArg.body, newCtx)
      })
    }
    throw new Error('map() requires a lambda function')
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

      // Direct function call - inject left value as first argument
      if (callNode.function.type === 'Identifier') {
        const funcName = (callNode.function as IdentifierNode).name
        const args = callNode.arguments.map(arg => this.evalNode(arg, pipeCtx))
        return this.callFunction(funcName, [leftValue, ...args], pipeCtx)
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

    // Otherwise, just evaluate right side with pipe context
    return this.evalNode(node.right, pipeCtx)
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
}

/**
 * Evaluate an AST node against a BenthosMessage
 */
export function evaluate(ast: ASTNode, message: BenthosMessage): unknown {
  const interpreter = new Interpreter(message)
  return interpreter.evaluate(ast)
}
