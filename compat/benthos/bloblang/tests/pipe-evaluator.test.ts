/**
 * RED Phase Tests: PipeEvaluator Submodule
 * Issue: dotdo-h5ix3 - Interpreter Decomposition
 *
 * These tests define the expected behavior for the PipeEvaluator class,
 * which handles pipe expression evaluation (`|`) in Bloblang.
 * They should FAIL until the PipeEvaluator is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { ASTNode, PipeNode, CallNode, IdentifierNode, MemberAccessNode, BinaryOpNode, ArrowNode } from '../ast'
import { BenthosMessage, createMessage } from '../../core/message'

// Import from the path that WILL be created during GREEN phase
import { PipeEvaluator, type PipeEvaluatorContext } from '../interpreter/PipeEvaluator'

/**
 * Helper functions to build AST nodes for testing
 */
namespace ASTBuilder {
  export function literal(value: string | number | boolean | null, line = 1, column = 1) {
    let kind: 'string' | 'number' | 'boolean' | 'null'
    if (value === null) kind = 'null'
    else if (typeof value === 'string') kind = 'string'
    else if (typeof value === 'number') kind = 'number'
    else kind = 'boolean'
    return { type: 'Literal' as const, kind, value, line, column }
  }

  export function identifier(name: string, line = 1, column = 1): IdentifierNode {
    return { type: 'Identifier', name, line, column }
  }

  export function call(func: ASTNode, args: ASTNode[] = [], line = 1, column = 1): CallNode {
    return { type: 'Call', function: func, arguments: args, line, column }
  }

  export function memberAccess(
    object: ASTNode,
    property: string | ASTNode,
    accessType: 'dot' | 'bracket' | 'optional' = 'dot',
    line = 1,
    column = 1
  ): MemberAccessNode {
    return { type: 'MemberAccess', object, property, accessType, line, column }
  }

  export function pipe(left: ASTNode, right: ASTNode, line = 1, column = 1): PipeNode {
    return { type: 'Pipe', left, right, line, column }
  }

  export function binaryOp(
    operator: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||' | 'in',
    left: ASTNode,
    right: ASTNode,
    line = 1,
    column = 1
  ): BinaryOpNode {
    return { type: 'BinaryOp', operator, left, right, line, column }
  }

  export function arrow(parameter: string, body: ASTNode, line = 1, column = 1): ArrowNode {
    return { type: 'Arrow', parameter, body, line, column }
  }

  export function array(elements: ASTNode[] = [], line = 1, column = 1) {
    return { type: 'Array' as const, elements, line, column }
  }
}

/**
 * PipeEvaluator Interface Definition (via tests)
 *
 * The PipeEvaluator should:
 * - Accept a PipeNode and a context
 * - Evaluate the left side first
 * - Pass the result as the pipe value to the right side
 * - Support method calls via pipe (value | method())
 * - Support function calls via pipe (value | function())
 * - Support the `_` placeholder for explicit pipe value reference
 * - Support chaining multiple pipes
 */
describe('PipeEvaluator', () => {
  let evaluator: PipeEvaluator
  let msg: BenthosMessage

  beforeEach(() => {
    msg = createMessage({
      name: 'Alice',
      age: 30,
      items: ['a', 'b', 'c'],
      text: 'hello world'
    })
    evaluator = new PipeEvaluator()
  })

  describe('Interface Contract', () => {
    it('should export PipeEvaluator class', () => {
      expect(PipeEvaluator).toBeDefined()
      expect(typeof PipeEvaluator).toBe('function')
    })

    it('should have evaluate method that accepts PipeNode and context', () => {
      expect(typeof evaluator.evaluate).toBe('function')
    })

    it('should export PipeEvaluatorContext type', () => {
      // This test validates the type exists via compilation
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node: ASTNode) => node,
        callMethod: (target: unknown, method: string, args: unknown[]) => undefined,
        callFunction: (name: string, args: unknown[]) => undefined,
      }
      expect(ctx).toBeDefined()
    })
  })

  describe('Basic Pipe Evaluation', () => {
    it('evaluates simple pipe to method call', () => {
      // "hello" | uppercase()
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'uppercase') {
            return target.toUpperCase()
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] === 'string') {
            return (args[0] as string).toUpperCase()
          }
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('HELLO')
    })

    it('evaluates pipe with numeric value', () => {
      // 42 | string()
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal(42),
        ASTBuilder.call(ASTBuilder.identifier('string'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (_target, method, _args) => {
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'string') return String(args[0])
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('42')
    })

    it('evaluates pipe with array value', () => {
      // [1, 2, 3] | length()
      const ast = ASTBuilder.pipe(
        ASTBuilder.array([
          ASTBuilder.literal(1),
          ASTBuilder.literal(2),
          ASTBuilder.literal(3)
        ]),
        ASTBuilder.call(ASTBuilder.identifier('length'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Array') {
            return (node as any).elements.map((e: any) => e.value)
          }
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (Array.isArray(target) && method === 'length') {
            return target.length
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'length' && Array.isArray(args[0])) {
            return args[0].length
          }
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(3)
    })
  })

  describe('Multiple Pipes Chained', () => {
    it('chains two pipes together', () => {
      // "hello" | uppercase() | length()
      const ast = ASTBuilder.pipe(
        ASTBuilder.pipe(
          ASTBuilder.literal('hello'),
          ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
        ),
        ASTBuilder.call(ASTBuilder.identifier('length'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Pipe') return evaluator.evaluate(node as PipeNode, ctx)
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'uppercase') return target.toUpperCase()
          if (typeof target === 'string' && method === 'length') return target.length
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] === 'string') return (args[0] as string).toUpperCase()
          if (name === 'length' && typeof args[0] === 'string') return args[0].length
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(5) // "HELLO".length
    })

    it('chains three pipes together', () => {
      // "hello world" | uppercase() | replace(" ", "_") | length()
      const ast = ASTBuilder.pipe(
        ASTBuilder.pipe(
          ASTBuilder.pipe(
            ASTBuilder.literal('hello world'),
            ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
          ),
          ASTBuilder.call(ASTBuilder.identifier('replace'), [
            ASTBuilder.literal(' '),
            ASTBuilder.literal('_')
          ])
        ),
        ASTBuilder.call(ASTBuilder.identifier('length'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Pipe') return evaluator.evaluate(node as PipeNode, ctx)
          return undefined
        },
        callMethod: (target, method, args) => {
          if (typeof target === 'string') {
            if (method === 'uppercase') return target.toUpperCase()
            if (method === 'replace') return target.replace(String(args[0]), String(args[1]))
            if (method === 'length') return target.length
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] === 'string') return (args[0] as string).toUpperCase()
          if (name === 'replace' && typeof args[0] === 'string') {
            return (args[0] as string).replace(String(args[1]), String(args[2]))
          }
          if (name === 'length' && typeof args[0] === 'string') return args[0].length
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(11) // "HELLO_WORLD".length
    })

    it('chains pipes with different value types', () => {
      // [1, 2, 3] | join(",") | uppercase()
      const ast = ASTBuilder.pipe(
        ASTBuilder.pipe(
          ASTBuilder.array([
            ASTBuilder.literal(1),
            ASTBuilder.literal(2),
            ASTBuilder.literal(3)
          ]),
          ASTBuilder.call(ASTBuilder.identifier('join'), [ASTBuilder.literal(',')])
        ),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Array') return (node as any).elements.map((e: any) => e.value)
          if (node.type === 'Pipe') return evaluator.evaluate(node as PipeNode, ctx)
          return undefined
        },
        callMethod: (target, method, args) => {
          if (Array.isArray(target) && method === 'join') return target.join(String(args[0]))
          if (typeof target === 'string' && method === 'uppercase') return target.toUpperCase()
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'join' && Array.isArray(args[0])) return args[0].join(String(args[1]))
          if (name === 'uppercase' && typeof args[0] === 'string') return (args[0] as string).toUpperCase()
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('1,2,3') // No uppercase effect on numbers, but join works
    })
  })

  describe('Pipe with Method Calls', () => {
    it('pipes to method on underscore placeholder', () => {
      // "hello" | _.uppercase()
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.call(
          ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'uppercase'),
          []
        )
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'uppercase') return target.toUpperCase()
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('HELLO')
    })

    it('pipes to method with arguments', () => {
      // "hello world" | _.replace("world", "there")
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello world'),
        ASTBuilder.call(
          ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'replace'),
          [ASTBuilder.literal('world'), ASTBuilder.literal('there')]
        )
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, args) => {
          if (typeof target === 'string' && method === 'replace') {
            return target.replace(String(args[0]), String(args[1]))
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('hello there')
    })

    it('pipes array to map method with arrow function', () => {
      // [1, 2, 3] | _.map(x -> x * 2)
      const ast = ASTBuilder.pipe(
        ASTBuilder.array([
          ASTBuilder.literal(1),
          ASTBuilder.literal(2),
          ASTBuilder.literal(3)
        ]),
        ASTBuilder.call(
          ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'map'),
          [ASTBuilder.arrow('x', ASTBuilder.binaryOp('*', ASTBuilder.identifier('x'), ASTBuilder.literal(2)))]
        )
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Array') return (node as any).elements.map((e: any) => e.value)
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (Array.isArray(target) && method === 'map') {
            // Simplified: just double each element for test
            return target.map(x => (x as number) * 2)
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toEqual([2, 4, 6])
    })
  })

  describe('Pipe with Function Calls', () => {
    it('pipes to function as first argument', () => {
      // "hello" | uppercase
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.identifier('uppercase')
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'uppercase') return target.toUpperCase()
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] === 'string') return (args[0] as string).toUpperCase()
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('HELLO')
    })

    it('pipes to function call with additional arguments', () => {
      // "5" | from_json() + 3
      // This tests pipe into a binary operation where left is a function call
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('"5"'),
        ASTBuilder.binaryOp(
          '+',
          ASTBuilder.call(ASTBuilder.identifier('from_json'), []),
          ASTBuilder.literal(3)
        )
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: () => { throw new Error('Not expected') },
        callFunction: (name, args) => {
          if (name === 'from_json') return JSON.parse(String(args[0]))
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(8) // 5 + 3
    })

    it('pipes to comparison after method call', () => {
      // "hello" | length > 3
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.binaryOp(
          '>',
          ASTBuilder.identifier('length'),
          ASTBuilder.literal(3)
        )
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'length') return target.length
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'length' && typeof args[0] === 'string') return args[0].length
          throw new Error(`Unknown function: ${name}`)
        },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(true) // 5 > 3
    })
  })

  describe('Error Propagation Through Pipes', () => {
    it('propagates error from left side evaluation', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.identifier('undefined_var'),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Identifier' && (node as IdentifierNode).name === 'undefined_var') {
            throw new Error('Undefined variable: undefined_var')
          }
          return undefined
        },
        callMethod: () => { throw new Error('Not expected') },
        callFunction: () => { throw new Error('Not expected') },
      }

      expect(() => evaluator.evaluate(ast, ctx)).toThrow('Undefined variable')
    })

    it('propagates error from method call', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.call(ASTBuilder.identifier('unknown_method'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (_target, method, _args) => {
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (_name, _args) => {
          throw new Error('Unknown function: unknown_method')
        },
      }

      expect(() => evaluator.evaluate(ast, ctx)).toThrow('Unknown')
    })

    it('handles null value in pipe gracefully', () => {
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal(null),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (target === null) {
            throw new Error(`Cannot call method '${method}' on null`)
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (_name, args) => {
          if (args[0] === null) {
            throw new Error('Cannot call function on null')
          }
          throw new Error('Unknown function')
        },
      }

      expect(() => evaluator.evaluate(ast, ctx)).toThrow()
    })

    it('propagates type error when piping incompatible types', () => {
      // 42 | uppercase() - numbers don't have uppercase
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal(42),
        ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target !== 'string' && method === 'uppercase') {
            throw new TypeError(`Cannot call uppercase on ${typeof target}`)
          }
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] !== 'string') {
            throw new TypeError(`uppercase requires string, got ${typeof args[0]}`)
          }
          throw new Error(`Unknown function: ${name}`)
        },
      }

      expect(() => evaluator.evaluate(ast, ctx)).toThrow(TypeError)
    })

    it('maintains error context through chained pipes', () => {
      // "hello" | uppercase() | undefined_method()
      const ast = ASTBuilder.pipe(
        ASTBuilder.pipe(
          ASTBuilder.literal('hello'),
          ASTBuilder.call(ASTBuilder.identifier('uppercase'), [])
        ),
        ASTBuilder.call(ASTBuilder.identifier('undefined_method'), [])
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          if (node.type === 'Pipe') return evaluator.evaluate(node as PipeNode, ctx)
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'uppercase') return target.toUpperCase()
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: (name, args) => {
          if (name === 'uppercase' && typeof args[0] === 'string') return (args[0] as string).toUpperCase()
          throw new Error(`Unknown function: ${name}`)
        },
      }

      expect(() => evaluator.evaluate(ast, ctx)).toThrow('Unknown')
    })
  })

  describe('Pipe Value Placeholder (_)', () => {
    it('resolves _ to the piped value', () => {
      // "hello" | _ + " world"
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('hello'),
        ASTBuilder.binaryOp('+', ASTBuilder.identifier('_'), ASTBuilder.literal(' world'))
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: () => { throw new Error('Not expected') },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe('hello world')
    })

    it('resolves _ multiple times in same expression', () => {
      // 5 | _ + _
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal(5),
        ASTBuilder.binaryOp('+', ASTBuilder.identifier('_'), ASTBuilder.identifier('_'))
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: () => { throw new Error('Not expected') },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(10)
    })
  })

  describe('Pipe with Member Access', () => {
    it('pipes to property access on underscore', () => {
      // { name: "Alice" } | _.name
      // Note: This requires the evaluator to recognize _.name as accessing pipe value's name property
      const ast = ASTBuilder.pipe(
        ASTBuilder.literal('test'), // Simplified - actual would be object
        ASTBuilder.memberAccess(ASTBuilder.identifier('_'), 'length')
      )
      const ctx: PipeEvaluatorContext = {
        message: msg,
        variables: new Map(),
        evalNode: (node) => {
          if (node.type === 'Literal') return (node as any).value
          return undefined
        },
        callMethod: (target, method, _args) => {
          if (typeof target === 'string' && method === 'length') return target.length
          throw new Error(`Unknown method: ${method}`)
        },
        callFunction: () => { throw new Error('Not expected') },
      }

      const result = evaluator.evaluate(ast, ctx)
      expect(result).toBe(4) // "test".length
    })
  })

  describe('isPipeMethod Helper', () => {
    it('identifies common pipeable methods for strings', () => {
      expect(evaluator.isPipeMethod('hello', 'length')).toBe(true)
      expect(evaluator.isPipeMethod('hello', 'uppercase')).toBe(true)
      expect(evaluator.isPipeMethod('hello', 'lowercase')).toBe(true)
      expect(evaluator.isPipeMethod('hello', 'trim')).toBe(true)
    })

    it('identifies common pipeable methods for arrays', () => {
      expect(evaluator.isPipeMethod([1, 2, 3], 'length')).toBe(true)
      expect(evaluator.isPipeMethod([1, 2, 3], 'first')).toBe(true)
      expect(evaluator.isPipeMethod([1, 2, 3], 'last')).toBe(true)
      expect(evaluator.isPipeMethod([1, 2, 3], 'sort')).toBe(true)
    })

    it('identifies common pipeable methods for objects', () => {
      expect(evaluator.isPipeMethod({ a: 1 }, 'keys')).toBe(true)
      expect(evaluator.isPipeMethod({ a: 1 }, 'values')).toBe(true)
    })

    it('returns false for unknown methods', () => {
      expect(evaluator.isPipeMethod('hello', 'unknownMethod')).toBe(false)
    })
  })
})
