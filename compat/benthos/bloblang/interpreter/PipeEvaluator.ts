/**
 * PipeEvaluator - Handles pipe expression evaluation (|) in Bloblang
 * Issue: dotdo-h5ix3 - Interpreter Decomposition
 *
 * Extracted from interpreter.ts to create a focused submodule for pipe operations.
 */

import type {
  ASTNode,
  PipeNode,
  CallNode,
  IdentifierNode,
  MemberAccessNode,
  BinaryOpNode,
} from '../ast'
import type { BenthosMessage } from '../../core/message'

/**
 * Context required by PipeEvaluator for evaluating pipe expressions
 */
export interface PipeEvaluatorContext {
  message: BenthosMessage
  variables: Map<string, unknown>
  /** Evaluate any AST node */
  evalNode: (node: ASTNode) => unknown
  /** Call a method on a target value */
  callMethod: (target: unknown, method: string, args: unknown[]) => unknown
  /** Call a global function */
  callFunction: (name: string, args: unknown[]) => unknown
}

/**
 * PipeEvaluator handles the evaluation of pipe expressions (|) in Bloblang.
 *
 * Pipe expressions allow chaining transformations:
 * - "hello" | uppercase() -> "HELLO"
 * - [1, 2, 3] | length() -> 3
 * - value | function(arg) -> function(value, arg)
 */
export class PipeEvaluator {
  /**
   * Evaluate a pipe expression
   */
  evaluate(node: PipeNode, ctx: PipeEvaluatorContext): unknown {
    // Evaluate left side first
    const leftValue = ctx.evalNode(node.left)

    // Handle right side based on its type
    return this.evaluateRight(leftValue, node.right, ctx)
  }

  /**
   * Evaluate the right side of a pipe with the left value available
   */
  private evaluateRight(leftValue: unknown, right: ASTNode, ctx: PipeEvaluatorContext): unknown {
    // Handle Call expression: value | func() or value | _.method()
    if (right.type === 'Call') {
      return this.evaluateCallWithPipe(leftValue, right as CallNode, ctx)
    }

    // Handle bare Identifier: value | funcName
    if (right.type === 'Identifier') {
      const funcName = (right as IdentifierNode).name
      return ctx.callFunction(funcName, [leftValue])
    }

    // Handle MemberAccess on _: value | _.property
    if (right.type === 'MemberAccess') {
      return this.evaluateMemberAccessWithPipe(leftValue, right as MemberAccessNode, ctx)
    }

    // Handle BinaryOp: value | expr > 3 or value | func() + 3
    if (right.type === 'BinaryOp') {
      return this.evaluateBinaryOpWithPipe(leftValue, right as BinaryOpNode, ctx)
    }

    // Default: evaluate with _ placeholder available
    // This would need the context to have _ set to leftValue
    return ctx.evalNode(right)
  }

  /**
   * Handle pipe to a function/method call
   */
  private evaluateCallWithPipe(leftValue: unknown, call: CallNode, ctx: PipeEvaluatorContext): unknown {
    // Check if this is a method call on _ (the pipe placeholder)
    if (call.function.type === 'MemberAccess') {
      const memberAccess = call.function as MemberAccessNode
      if (memberAccess.object.type === 'Identifier' &&
          (memberAccess.object as IdentifierNode).name === '_') {
        // Replace _ with the actual pipe value and call the method
        const methodName = typeof memberAccess.property === 'string'
          ? memberAccess.property
          : String(ctx.evalNode(memberAccess.property))
        const args = call.arguments.map(arg => ctx.evalNode(arg))
        return ctx.callMethod(leftValue, methodName, args)
      }
    }

    // Direct function call - first try as method on piped value, then as global function
    if (call.function.type === 'Identifier') {
      const funcName = (call.function as IdentifierNode).name
      const args = call.arguments.map(arg => ctx.evalNode(arg))

      // Try calling as a method on the piped value first
      try {
        return ctx.callMethod(leftValue, funcName, args)
      } catch {
        // Fall back to calling as a global function with piped value as first arg
        return ctx.callFunction(funcName, [leftValue, ...args])
      }
    }

    // Unknown call pattern
    throw new Error('Unsupported pipe call pattern')
  }

  /**
   * Handle pipe to member access (e.g., value | _.length)
   */
  private evaluateMemberAccessWithPipe(leftValue: unknown, access: MemberAccessNode, ctx: PipeEvaluatorContext): unknown {
    // Check if accessing property/method on _ placeholder
    if (access.object.type === 'Identifier' &&
        (access.object as IdentifierNode).name === '_') {
      const propName = typeof access.property === 'string'
        ? access.property
        : String(ctx.evalNode(access.property))

      // For strings and arrays, property access can be method calls
      if (typeof leftValue === 'string') {
        if (propName === 'length') return leftValue.length
        return ctx.callMethod(leftValue, propName, [])
      }

      if (Array.isArray(leftValue)) {
        if (propName === 'length') return leftValue.length
        return ctx.callMethod(leftValue, propName, [])
      }

      // For objects, return the property value
      if (typeof leftValue === 'object' && leftValue !== null) {
        return (leftValue as Record<string, unknown>)[propName]
      }
    }

    return ctx.evalNode(access)
  }

  /**
   * Handle pipe to binary operation (e.g., value | length > 3)
   */
  private evaluateBinaryOpWithPipe(leftValue: unknown, binOp: BinaryOpNode, ctx: PipeEvaluatorContext): unknown {
    // Evaluate the left side of the binary op, resolving _ and pipe methods
    const leftResult = this.evaluateBinaryOpSide(leftValue, binOp.left, ctx)

    // Evaluate the right side of the binary op, resolving _ placeholder
    const rightResult = this.evaluateBinaryOpSide(leftValue, binOp.right, ctx)

    // Apply the binary operator
    return this.evalBinaryOpValues(binOp.operator, leftResult, rightResult)
  }

  /**
   * Evaluate one side of a binary operation, handling _ placeholder and pipe methods
   */
  private evaluateBinaryOpSide(pipeValue: unknown, node: ASTNode, ctx: PipeEvaluatorContext): unknown {
    // Handle _ placeholder - return the pipe value directly
    if (node.type === 'Identifier') {
      const name = (node as IdentifierNode).name
      if (name === '_') {
        return pipeValue
      }
      // Check if it's a method that should be called on the pipe value
      if (this.isPipeMethod(pipeValue, name)) {
        return this.callPipeMethod(pipeValue, name, ctx)
      }
    }

    // Handle Call nodes - inject pipe value if needed
    if (node.type === 'Call') {
      const call = node as CallNode
      if (call.function.type === 'Identifier') {
        const funcName = (call.function as IdentifierNode).name
        const args = call.arguments.map(arg => this.evaluateBinaryOpSide(pipeValue, arg, ctx))
        try {
          return ctx.callMethod(pipeValue, funcName, args)
        } catch {
          return ctx.callFunction(funcName, [pipeValue, ...args])
        }
      }
    }

    // Default: use the provided evalNode callback
    return ctx.evalNode(node)
  }

  /**
   * Call a method on a piped value
   */
  private callPipeMethod(value: unknown, method: string, ctx: PipeEvaluatorContext): unknown {
    if (typeof value === 'string') {
      if (method === 'length') return value.length
      return ctx.callMethod(value, method, [])
    }
    if (Array.isArray(value)) {
      if (method === 'length') return value.length
      return ctx.callMethod(value, method, [])
    }
    if (typeof value === 'object' && value !== null) {
      return ctx.callMethod(value, method, [])
    }
    return ctx.callFunction(method, [value])
  }

  /**
   * Check if a method name is a valid pipe method for the given value type
   */
  isPipeMethod(value: unknown, method: string): boolean {
    // String methods
    if (typeof value === 'string') {
      const stringMethods = ['length', 'uppercase', 'lowercase', 'trim', 'split', 'replace',
        'contains', 'has_prefix', 'has_suffix', 'slice', 'substring']
      return stringMethods.includes(method)
    }

    // Array methods
    if (Array.isArray(value)) {
      const arrayMethods = ['length', 'first', 'last', 'sort', 'reverse', 'join', 'flatten',
        'unique', 'contains', 'map', 'filter', 'reduce', 'slice', 'sum']
      return arrayMethods.includes(method)
    }

    // Object methods
    if (typeof value === 'object' && value !== null) {
      const objectMethods = ['keys', 'values', 'entries']
      return objectMethods.includes(method)
    }

    return false
  }

  /**
   * Evaluate a binary operation with already-evaluated values
   */
  private evalBinaryOpValues(op: string, left: unknown, right: unknown): unknown {
    switch (op) {
      case '+':
        // If both are already numbers, add them
        if (typeof left === 'number' && typeof right === 'number') {
          return left + right
        }
        // If one is a number and the other is a numeric string, do numeric addition
        if (typeof left === 'string' && typeof right === 'number') {
          const leftNum = Number(left)
          if (!isNaN(leftNum)) {
            return leftNum + right
          }
        }
        if (typeof right === 'string' && typeof left === 'number') {
          const rightNum = Number(right)
          if (!isNaN(rightNum)) {
            return left + rightNum
          }
        }
        // Otherwise, do string concatenation
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

  /**
   * Loose equality comparison (Bloblang semantics)
   */
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

  /**
   * Bloblang truthiness check
   */
  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (value === false) return false
    if (value === 0) return false
    if (value === '') return false
    return true
  }
}
