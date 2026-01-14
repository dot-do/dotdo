/**
 * RED Phase Tests: Bloblang AST Node Types
 * Issue: dotdo-1kvi4 - Milestone 2
 *
 * These tests define the expected AST node interfaces and type guards.
 * They should FAIL until ast.ts is implemented.
 */
import { describe, it, expect } from 'vitest'
import {
  // Node types
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
  MapNode,
  PipeNode,
  ArrowNode,
  AssignNode,
  // Type guards
  isLiteralNode,
  isIdentifierNode,
  isRootNode,
  isThisNode,
  isMetaNode,
  isBinaryOpNode,
  isUnaryOpNode,
  isMemberAccessNode,
  isCallNode,
  isArrayNode,
  isObjectNode,
  isIfNode,
  isMatchNode,
  isLetNode,
  isMapNode,
  isPipeNode,
  isArrowNode,
  isAssignNode,
  ASTNode,
  BinaryOperator,
  UnaryOperator,
  AccessType
} from '../ast'

describe('AST Node Types', () => {
  describe('LiteralNode', () => {
    it('should create string literal node', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'hello',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Literal')
      expect(node.kind).toBe('string')
      expect(node.value).toBe('hello')
      expect(node.line).toBe(1)
      expect(node.column).toBe(1)
    })

    it('should create number literal node', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 42,
        line: 2,
        column: 5
      }

      expect(node.type).toBe('Literal')
      expect(node.kind).toBe('number')
      expect(node.value).toBe(42)
    })

    it('should create boolean literal node (true)', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: true,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Literal')
      expect(node.kind).toBe('boolean')
      expect(node.value).toBe(true)
    })

    it('should create boolean literal node (false)', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: false,
        line: 1,
        column: 1
      }

      expect(node.kind).toBe('boolean')
      expect(node.value).toBe(false)
    })

    it('should create null literal node', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'null',
        value: null,
        line: 1,
        column: 1
      }

      expect(node.kind).toBe('null')
      expect(node.value).toBeNull()
    })

    it('should have location info', () => {
      const node: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'test',
        line: 5,
        column: 10
      }

      expect(node.line).toBe(5)
      expect(node.column).toBe(10)
    })
  })

  describe('IdentifierNode', () => {
    it('should create simple identifier node', () => {
      const node: IdentifierNode = {
        type: 'Identifier',
        name: 'foo',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Identifier')
      expect(node.name).toBe('foo')
    })

    it('should support identifier with underscores', () => {
      const node: IdentifierNode = {
        type: 'Identifier',
        name: 'foo_bar_baz',
        line: 1,
        column: 1
      }

      expect(node.name).toBe('foo_bar_baz')
    })

    it('should support identifier with numbers', () => {
      const node: IdentifierNode = {
        type: 'Identifier',
        name: 'var123',
        line: 1,
        column: 1
      }

      expect(node.name).toBe('var123')
    })

    it('should have location info', () => {
      const node: IdentifierNode = {
        type: 'Identifier',
        name: 'x',
        line: 3,
        column: 7
      }

      expect(node.line).toBe(3)
      expect(node.column).toBe(7)
    })
  })

  describe('RootNode', () => {
    it('should create root node', () => {
      const node: RootNode = {
        type: 'Root',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Root')
    })

    it('should have location info', () => {
      const node: RootNode = {
        type: 'Root',
        line: 2,
        column: 3
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(3)
    })
  })

  describe('ThisNode', () => {
    it('should create this node', () => {
      const node: ThisNode = {
        type: 'This',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('This')
    })

    it('should have location info', () => {
      const node: ThisNode = {
        type: 'This',
        line: 4,
        column: 2
      }

      expect(node.line).toBe(4)
      expect(node.column).toBe(2)
    })
  })

  describe('MetaNode', () => {
    it('should create meta node', () => {
      const node: MetaNode = {
        type: 'Meta',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Meta')
    })

    it('should have location info', () => {
      const node: MetaNode = {
        type: 'Meta',
        line: 1,
        column: 5
      }

      expect(node.line).toBe(1)
      expect(node.column).toBe(5)
    })
  })

  describe('BinaryOpNode', () => {
    it('should create addition node', () => {
      const left: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 1,
        line: 1,
        column: 1
      }
      const right: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 2,
        line: 1,
        column: 5
      }
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '+',
        left,
        right,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('BinaryOp')
      expect(node.operator).toBe('+')
      expect(node.left).toBe(left)
      expect(node.right).toBe(right)
    })

    it('should create subtraction node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '-',
        left: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 3, line: 1, column: 5 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('-')
    })

    it('should create multiplication node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '*',
        left: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 3, line: 1, column: 5 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('*')
    })

    it('should create division node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '/',
        left: { type: 'Literal', kind: 'number', value: 10, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 6 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('/')
    })

    it('should create modulo node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '%',
        left: { type: 'Literal', kind: 'number', value: 10, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 3, line: 1, column: 6 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('%')
    })

    it('should create equality comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '==',
        left: { type: 'Literal', kind: 'string', value: 'a', line: 1, column: 1 },
        right: { type: 'Literal', kind: 'string', value: 'a', line: 1, column: 7 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('==')
    })

    it('should create not equal comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '!=',
        left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 6 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('!=')
    })

    it('should create less than comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '<',
        left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 5 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('<')
    })

    it('should create greater than comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '>',
        left: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 3, line: 1, column: 5 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('>')
    })

    it('should create less than or equal comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '<=',
        left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 6 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('<=')
    })

    it('should create greater than or equal comparison node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '>=',
        left: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 3, line: 1, column: 6 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('>=')
    })

    it('should create logical AND node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '&&',
        left: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'boolean', value: false, line: 1, column: 7 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('&&')
    })

    it('should create logical OR node', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '||',
        left: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'boolean', value: false, line: 1, column: 7 },
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('||')
    })

    it('should have location info', () => {
      const node: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '+',
        left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
        right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 5 },
        line: 2,
        column: 3
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(3)
    })
  })

  describe('UnaryOpNode', () => {
    it('should create negation node', () => {
      const operand: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 5,
        line: 1,
        column: 2
      }
      const node: UnaryOpNode = {
        type: 'UnaryOp',
        operator: '-',
        operand,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('UnaryOp')
      expect(node.operator).toBe('-')
      expect(node.operand).toBe(operand)
    })

    it('should create logical NOT node', () => {
      const operand: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: true,
        line: 1,
        column: 2
      }
      const node: UnaryOpNode = {
        type: 'UnaryOp',
        operator: '!',
        operand,
        line: 1,
        column: 1
      }

      expect(node.operator).toBe('!')
      expect(node.operand).toBe(operand)
    })

    it('should have location info', () => {
      const node: UnaryOpNode = {
        type: 'UnaryOp',
        operator: '-',
        operand: { type: 'Literal', kind: 'number', value: 10, line: 1, column: 2 },
        line: 3,
        column: 4
      }

      expect(node.line).toBe(3)
      expect(node.column).toBe(4)
    })
  })

  describe('MemberAccessNode', () => {
    it('should create dot access node', () => {
      const object: IdentifierNode = {
        type: 'Identifier',
        name: 'obj',
        line: 1,
        column: 1
      }
      const node: MemberAccessNode = {
        type: 'MemberAccess',
        object,
        property: 'field',
        accessType: 'dot',
        line: 1,
        column: 1
      }

      expect(node.type).toBe('MemberAccess')
      expect(node.object).toBe(object)
      expect(node.property).toBe('field')
      expect(node.accessType).toBe('dot')
    })

    it('should create bracket access node', () => {
      const object: IdentifierNode = {
        type: 'Identifier',
        name: 'arr',
        line: 1,
        column: 1
      }
      const index: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 0,
        line: 1,
        column: 6
      }
      const node: MemberAccessNode = {
        type: 'MemberAccess',
        object,
        property: index,
        accessType: 'bracket',
        line: 1,
        column: 1
      }

      expect(node.accessType).toBe('bracket')
      expect(node.property).toBe(index)
    })

    it('should create optional chaining node', () => {
      const object: IdentifierNode = {
        type: 'Identifier',
        name: 'obj',
        line: 1,
        column: 1
      }
      const node: MemberAccessNode = {
        type: 'MemberAccess',
        object,
        property: 'field',
        accessType: 'optional',
        line: 1,
        column: 1
      }

      expect(node.accessType).toBe('optional')
    })

    it('should have location info', () => {
      const node: MemberAccessNode = {
        type: 'MemberAccess',
        object: { type: 'Identifier', name: 'x', line: 1, column: 1 },
        property: 'y',
        accessType: 'dot',
        line: 4,
        column: 2
      }

      expect(node.line).toBe(4)
      expect(node.column).toBe(2)
    })
  })

  describe('CallNode', () => {
    it('should create function call node', () => {
      const func: IdentifierNode = {
        type: 'Identifier',
        name: 'len',
        line: 1,
        column: 1
      }
      const node: CallNode = {
        type: 'Call',
        function: func,
        arguments: [],
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Call')
      expect(node.function).toBe(func)
      expect(node.arguments).toEqual([])
    })

    it('should create function call with single argument', () => {
      const func: IdentifierNode = {
        type: 'Identifier',
        name: 'len',
        line: 1,
        column: 1
      }
      const arg: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'hello',
        line: 1,
        column: 5
      }
      const node: CallNode = {
        type: 'Call',
        function: func,
        arguments: [arg],
        line: 1,
        column: 1
      }

      expect(node.arguments).toHaveLength(1)
      expect(node.arguments[0]).toBe(arg)
    })

    it('should create function call with multiple arguments', () => {
      const func: IdentifierNode = {
        type: 'Identifier',
        name: 'substring',
        line: 1,
        column: 1
      }
      const arg1: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'hello',
        line: 1,
        column: 12
      }
      const arg2: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 0,
        line: 1,
        column: 20
      }
      const arg3: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 2,
        line: 1,
        column: 23
      }
      const node: CallNode = {
        type: 'Call',
        function: func,
        arguments: [arg1, arg2, arg3],
        line: 1,
        column: 1
      }

      expect(node.arguments).toHaveLength(3)
      expect(node.arguments[0]).toBe(arg1)
      expect(node.arguments[1]).toBe(arg2)
      expect(node.arguments[2]).toBe(arg3)
    })

    it('should have location info', () => {
      const node: CallNode = {
        type: 'Call',
        function: { type: 'Identifier', name: 'foo', line: 1, column: 1 },
        arguments: [],
        line: 2,
        column: 5
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(5)
    })
  })

  describe('ArrayNode', () => {
    it('should create empty array literal', () => {
      const node: ArrayNode = {
        type: 'Array',
        elements: [],
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Array')
      expect(node.elements).toEqual([])
    })

    it('should create array with single element', () => {
      const elem: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 1,
        line: 1,
        column: 2
      }
      const node: ArrayNode = {
        type: 'Array',
        elements: [elem],
        line: 1,
        column: 1
      }

      expect(node.elements).toHaveLength(1)
      expect(node.elements[0]).toBe(elem)
    })

    it('should create array with multiple elements', () => {
      const elem1: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 1,
        line: 1,
        column: 2
      }
      const elem2: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'two',
        line: 1,
        column: 5
      }
      const elem3: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: true,
        line: 1,
        column: 12
      }
      const node: ArrayNode = {
        type: 'Array',
        elements: [elem1, elem2, elem3],
        line: 1,
        column: 1
      }

      expect(node.elements).toHaveLength(3)
      expect(node.elements[0]).toBe(elem1)
      expect(node.elements[1]).toBe(elem2)
      expect(node.elements[2]).toBe(elem3)
    })

    it('should have location info', () => {
      const node: ArrayNode = {
        type: 'Array',
        elements: [],
        line: 5,
        column: 10
      }

      expect(node.line).toBe(5)
      expect(node.column).toBe(10)
    })
  })

  describe('ObjectNode', () => {
    it('should create empty object literal', () => {
      const node: ObjectNode = {
        type: 'Object',
        fields: [],
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Object')
      expect(node.fields).toEqual([])
    })

    it('should create object with single field', () => {
      const value: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'bar',
        line: 1,
        column: 8
      }
      const node: ObjectNode = {
        type: 'Object',
        fields: [
          {
            key: 'foo',
            value
          }
        ],
        line: 1,
        column: 1
      }

      expect(node.fields).toHaveLength(1)
      expect(node.fields[0].key).toBe('foo')
      expect(node.fields[0].value).toBe(value)
    })

    it('should create object with multiple fields', () => {
      const value1: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'hello',
        line: 1,
        column: 8
      }
      const value2: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 42,
        line: 1,
        column: 21
      }
      const node: ObjectNode = {
        type: 'Object',
        fields: [
          { key: 'name', value: value1 },
          { key: 'age', value: value2 }
        ],
        line: 1,
        column: 1
      }

      expect(node.fields).toHaveLength(2)
      expect(node.fields[0].key).toBe('name')
      expect(node.fields[1].key).toBe('age')
    })

    it('should have location info', () => {
      const node: ObjectNode = {
        type: 'Object',
        fields: [],
        line: 3,
        column: 7
      }

      expect(node.line).toBe(3)
      expect(node.column).toBe(7)
    })
  })

  describe('IfNode', () => {
    it('should create if node with only consequent', () => {
      const condition: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: true,
        line: 1,
        column: 4
      }
      const consequent: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'yes',
        line: 1,
        column: 10
      }
      const node: IfNode = {
        type: 'If',
        condition,
        consequent,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('If')
      expect(node.condition).toBe(condition)
      expect(node.consequent).toBe(consequent)
      expect(node.alternate).toBeUndefined()
    })

    it('should create if node with else clause', () => {
      const condition: LiteralNode = {
        type: 'Literal',
        kind: 'boolean',
        value: true,
        line: 1,
        column: 4
      }
      const consequent: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'yes',
        line: 1,
        column: 10
      }
      const alternate: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'no',
        line: 1,
        column: 20
      }
      const node: IfNode = {
        type: 'If',
        condition,
        consequent,
        alternate,
        line: 1,
        column: 1
      }

      expect(node.alternate).toBe(alternate)
    })

    it('should have location info', () => {
      const node: IfNode = {
        type: 'If',
        condition: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
        consequent: { type: 'Literal', kind: 'string', value: 'x', line: 1, column: 1 },
        line: 2,
        column: 3
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(3)
    })
  })

  describe('MatchNode', () => {
    it('should create match node with cases', () => {
      const input: IdentifierNode = {
        type: 'Identifier',
        name: 'x',
        line: 1,
        column: 7
      }
      const casePattern: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'foo',
        line: 2,
        column: 4
      }
      const caseBody: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 1,
        line: 2,
        column: 15
      }
      const node: MatchNode = {
        type: 'Match',
        input,
        cases: [
          {
            pattern: casePattern,
            body: caseBody
          }
        ],
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Match')
      expect(node.input).toBe(input)
      expect(node.cases).toHaveLength(1)
      expect(node.cases[0].pattern).toBe(casePattern)
      expect(node.cases[0].body).toBe(caseBody)
    })

    it('should create match node with multiple cases', () => {
      const input: IdentifierNode = {
        type: 'Identifier',
        name: 'status',
        line: 1,
        column: 7
      }
      const node: MatchNode = {
        type: 'Match',
        input,
        cases: [
          {
            pattern: { type: 'Literal', kind: 'string', value: 'ok', line: 2, column: 4 },
            body: { type: 'Literal', kind: 'number', value: 200, line: 2, column: 15 }
          },
          {
            pattern: { type: 'Literal', kind: 'string', value: 'error', line: 3, column: 4 },
            body: { type: 'Literal', kind: 'number', value: 500, line: 3, column: 15 }
          }
        ],
        line: 1,
        column: 1
      }

      expect(node.cases).toHaveLength(2)
    })

    it('should create match node with default case', () => {
      const input: IdentifierNode = {
        type: 'Identifier',
        name: 'x',
        line: 1,
        column: 7
      }
      const defaultBody: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'default',
        line: 3,
        column: 4
      }
      const node: MatchNode = {
        type: 'Match',
        input,
        cases: [
          {
            pattern: { type: 'Literal', kind: 'string', value: 'foo', line: 2, column: 4 },
            body: { type: 'Literal', kind: 'number', value: 1, line: 2, column: 15 }
          }
        ],
        default: defaultBody,
        line: 1,
        column: 1
      }

      expect(node.default).toBe(defaultBody)
    })

    it('should have location info', () => {
      const node: MatchNode = {
        type: 'Match',
        input: { type: 'Identifier', name: 'x', line: 1, column: 1 },
        cases: [],
        line: 3,
        column: 2
      }

      expect(node.line).toBe(3)
      expect(node.column).toBe(2)
    })
  })

  describe('LetNode', () => {
    it('should create let node for variable binding', () => {
      const value: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 42,
        line: 1,
        column: 9
      }
      const body: IdentifierNode = {
        type: 'Identifier',
        name: 'x',
        line: 1,
        column: 20
      }
      const node: LetNode = {
        type: 'Let',
        name: 'x',
        value,
        body,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Let')
      expect(node.name).toBe('x')
      expect(node.value).toBe(value)
      expect(node.body).toBe(body)
    })

    it('should have location info', () => {
      const node: LetNode = {
        type: 'Let',
        name: 'foo',
        value: { type: 'Literal', kind: 'string', value: 'bar', line: 1, column: 1 },
        body: { type: 'Identifier', name: 'foo', line: 1, column: 1 },
        line: 2,
        column: 4
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(4)
    })
  })

  describe('MapNode', () => {
    it('should create map node with lambda', () => {
      const lambda: ArrowNode = {
        type: 'Arrow',
        parameter: 'item',
        body: { type: 'Identifier', name: 'item', line: 1, column: 15 },
        line: 1,
        column: 8
      }
      const node: MapNode = {
        type: 'Map',
        lambda,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Map')
      expect(node.lambda).toBe(lambda)
    })

    it('should have location info', () => {
      const node: MapNode = {
        type: 'Map',
        lambda: {
          type: 'Arrow',
          parameter: 'x',
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        },
        line: 3,
        column: 5
      }

      expect(node.line).toBe(3)
      expect(node.column).toBe(5)
    })
  })

  describe('PipeNode', () => {
    it('should create pipe node with left and right', () => {
      const left: IdentifierNode = {
        type: 'Identifier',
        name: 'data',
        line: 1,
        column: 1
      }
      const right: CallNode = {
        type: 'Call',
        function: { type: 'Identifier', name: 'len', line: 1, column: 8 },
        arguments: [],
        line: 1,
        column: 8
      }
      const node: PipeNode = {
        type: 'Pipe',
        left,
        right,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Pipe')
      expect(node.left).toBe(left)
      expect(node.right).toBe(right)
    })

    it('should have location info', () => {
      const node: PipeNode = {
        type: 'Pipe',
        left: { type: 'Identifier', name: 'x', line: 1, column: 1 },
        right: { type: 'Identifier', name: 'y', line: 1, column: 1 },
        line: 2,
        column: 3
      }

      expect(node.line).toBe(2)
      expect(node.column).toBe(3)
    })
  })

  describe('ArrowNode', () => {
    it('should create arrow node with parameter and body', () => {
      const body: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 42,
        line: 1,
        column: 8
      }
      const node: ArrowNode = {
        type: 'Arrow',
        parameter: 'x',
        body,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Arrow')
      expect(node.parameter).toBe('x')
      expect(node.body).toBe(body)
    })

    it('should create arrow node with complex body', () => {
      const body: BinaryOpNode = {
        type: 'BinaryOp',
        operator: '*',
        left: { type: 'Identifier', name: 'x', line: 1, column: 8 },
        right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 12 },
        line: 1,
        column: 8
      }
      const node: ArrowNode = {
        type: 'Arrow',
        parameter: 'x',
        body,
        line: 1,
        column: 1
      }

      expect(node.body).toBe(body)
    })

    it('should have location info', () => {
      const node: ArrowNode = {
        type: 'Arrow',
        parameter: 'n',
        body: { type: 'Identifier', name: 'n', line: 1, column: 1 },
        line: 4,
        column: 6
      }

      expect(node.line).toBe(4)
      expect(node.column).toBe(6)
    })
  })

  describe('AssignNode', () => {
    it('should create assign node for field assignment', () => {
      const value: LiteralNode = {
        type: 'Literal',
        kind: 'string',
        value: 'hello',
        line: 1,
        column: 9
      }
      const node: AssignNode = {
        type: 'Assign',
        field: 'greeting',
        value,
        line: 1,
        column: 1
      }

      expect(node.type).toBe('Assign')
      expect(node.field).toBe('greeting')
      expect(node.value).toBe(value)
    })

    it('should create assign node with nested field path', () => {
      const value: LiteralNode = {
        type: 'Literal',
        kind: 'number',
        value: 42,
        line: 1,
        column: 13
      }
      const node: AssignNode = {
        type: 'Assign',
        field: 'obj.deep.field',
        value,
        line: 1,
        column: 1
      }

      expect(node.field).toBe('obj.deep.field')
    })

    it('should have location info', () => {
      const node: AssignNode = {
        type: 'Assign',
        field: 'x',
        value: { type: 'Literal', kind: 'string', value: 'y', line: 1, column: 1 },
        line: 5,
        column: 8
      }

      expect(node.line).toBe(5)
      expect(node.column).toBe(8)
    })
  })

  describe('Type Guards', () => {
    describe('isLiteralNode', () => {
      it('should identify literal nodes', () => {
        const node: LiteralNode = {
          type: 'Literal',
          kind: 'string',
          value: 'test',
          line: 1,
          column: 1
        }

        expect(isLiteralNode(node)).toBe(true)
      })

      it('should reject non-literal nodes', () => {
        const node: IdentifierNode = {
          type: 'Identifier',
          name: 'foo',
          line: 1,
          column: 1
        }

        expect(isLiteralNode(node)).toBe(false)
      })
    })

    describe('isIdentifierNode', () => {
      it('should identify identifier nodes', () => {
        const node: IdentifierNode = {
          type: 'Identifier',
          name: 'foo',
          line: 1,
          column: 1
        }

        expect(isIdentifierNode(node)).toBe(true)
      })

      it('should reject non-identifier nodes', () => {
        const node: LiteralNode = {
          type: 'Literal',
          kind: 'string',
          value: 'foo',
          line: 1,
          column: 1
        }

        expect(isIdentifierNode(node)).toBe(false)
      })
    })

    describe('isRootNode', () => {
      it('should identify root nodes', () => {
        const node: RootNode = {
          type: 'Root',
          line: 1,
          column: 1
        }

        expect(isRootNode(node)).toBe(true)
      })

      it('should reject non-root nodes', () => {
        const node: ThisNode = {
          type: 'This',
          line: 1,
          column: 1
        }

        expect(isRootNode(node)).toBe(false)
      })
    })

    describe('isThisNode', () => {
      it('should identify this nodes', () => {
        const node: ThisNode = {
          type: 'This',
          line: 1,
          column: 1
        }

        expect(isThisNode(node)).toBe(true)
      })

      it('should reject non-this nodes', () => {
        const node: RootNode = {
          type: 'Root',
          line: 1,
          column: 1
        }

        expect(isThisNode(node)).toBe(false)
      })
    })

    describe('isMetaNode', () => {
      it('should identify meta nodes', () => {
        const node: MetaNode = {
          type: 'Meta',
          line: 1,
          column: 1
        }

        expect(isMetaNode(node)).toBe(true)
      })

      it('should reject non-meta nodes', () => {
        const node: RootNode = {
          type: 'Root',
          line: 1,
          column: 1
        }

        expect(isMetaNode(node)).toBe(false)
      })
    })

    describe('isBinaryOpNode', () => {
      it('should identify binary op nodes', () => {
        const node: BinaryOpNode = {
          type: 'BinaryOp',
          operator: '+',
          left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
          right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isBinaryOpNode(node)).toBe(true)
      })

      it('should reject non-binary op nodes', () => {
        const node: UnaryOpNode = {
          type: 'UnaryOp',
          operator: '-',
          operand: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isBinaryOpNode(node)).toBe(false)
      })
    })

    describe('isUnaryOpNode', () => {
      it('should identify unary op nodes', () => {
        const node: UnaryOpNode = {
          type: 'UnaryOp',
          operator: '-',
          operand: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isUnaryOpNode(node)).toBe(true)
      })

      it('should reject non-unary op nodes', () => {
        const node: BinaryOpNode = {
          type: 'BinaryOp',
          operator: '+',
          left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
          right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isUnaryOpNode(node)).toBe(false)
      })
    })

    describe('isMemberAccessNode', () => {
      it('should identify member access nodes', () => {
        const node: MemberAccessNode = {
          type: 'MemberAccess',
          object: { type: 'Identifier', name: 'obj', line: 1, column: 1 },
          property: 'field',
          accessType: 'dot',
          line: 1,
          column: 1
        }

        expect(isMemberAccessNode(node)).toBe(true)
      })

      it('should reject non-member access nodes', () => {
        const node: CallNode = {
          type: 'Call',
          function: { type: 'Identifier', name: 'foo', line: 1, column: 1 },
          arguments: [],
          line: 1,
          column: 1
        }

        expect(isMemberAccessNode(node)).toBe(false)
      })
    })

    describe('isCallNode', () => {
      it('should identify call nodes', () => {
        const node: CallNode = {
          type: 'Call',
          function: { type: 'Identifier', name: 'foo', line: 1, column: 1 },
          arguments: [],
          line: 1,
          column: 1
        }

        expect(isCallNode(node)).toBe(true)
      })

      it('should reject non-call nodes', () => {
        const node: MemberAccessNode = {
          type: 'MemberAccess',
          object: { type: 'Identifier', name: 'obj', line: 1, column: 1 },
          property: 'field',
          accessType: 'dot',
          line: 1,
          column: 1
        }

        expect(isCallNode(node)).toBe(false)
      })
    })

    describe('isArrayNode', () => {
      it('should identify array nodes', () => {
        const node: ArrayNode = {
          type: 'Array',
          elements: [],
          line: 1,
          column: 1
        }

        expect(isArrayNode(node)).toBe(true)
      })

      it('should reject non-array nodes', () => {
        const node: ObjectNode = {
          type: 'Object',
          fields: [],
          line: 1,
          column: 1
        }

        expect(isArrayNode(node)).toBe(false)
      })
    })

    describe('isObjectNode', () => {
      it('should identify object nodes', () => {
        const node: ObjectNode = {
          type: 'Object',
          fields: [],
          line: 1,
          column: 1
        }

        expect(isObjectNode(node)).toBe(true)
      })

      it('should reject non-object nodes', () => {
        const node: ArrayNode = {
          type: 'Array',
          elements: [],
          line: 1,
          column: 1
        }

        expect(isObjectNode(node)).toBe(false)
      })
    })

    describe('isIfNode', () => {
      it('should identify if nodes', () => {
        const node: IfNode = {
          type: 'If',
          condition: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
          consequent: { type: 'Literal', kind: 'string', value: 'yes', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isIfNode(node)).toBe(true)
      })

      it('should reject non-if nodes', () => {
        const node: MatchNode = {
          type: 'Match',
          input: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          cases: [],
          line: 1,
          column: 1
        }

        expect(isIfNode(node)).toBe(false)
      })
    })

    describe('isMatchNode', () => {
      it('should identify match nodes', () => {
        const node: MatchNode = {
          type: 'Match',
          input: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          cases: [],
          line: 1,
          column: 1
        }

        expect(isMatchNode(node)).toBe(true)
      })

      it('should reject non-match nodes', () => {
        const node: IfNode = {
          type: 'If',
          condition: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
          consequent: { type: 'Literal', kind: 'string', value: 'yes', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isMatchNode(node)).toBe(false)
      })
    })

    describe('isLetNode', () => {
      it('should identify let nodes', () => {
        const node: LetNode = {
          type: 'Let',
          name: 'x',
          value: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isLetNode(node)).toBe(true)
      })

      it('should reject non-let nodes', () => {
        const node: MapNode = {
          type: 'Map',
          lambda: {
            type: 'Arrow',
            parameter: 'x',
            body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
            line: 1,
            column: 1
          },
          line: 1,
          column: 1
        }

        expect(isLetNode(node)).toBe(false)
      })
    })

    describe('isMapNode', () => {
      it('should identify map nodes', () => {
        const node: MapNode = {
          type: 'Map',
          lambda: {
            type: 'Arrow',
            parameter: 'x',
            body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
            line: 1,
            column: 1
          },
          line: 1,
          column: 1
        }

        expect(isMapNode(node)).toBe(true)
      })

      it('should reject non-map nodes', () => {
        const node: PipeNode = {
          type: 'Pipe',
          left: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          right: { type: 'Identifier', name: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isMapNode(node)).toBe(false)
      })
    })

    describe('isPipeNode', () => {
      it('should identify pipe nodes', () => {
        const node: PipeNode = {
          type: 'Pipe',
          left: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          right: { type: 'Identifier', name: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isPipeNode(node)).toBe(true)
      })

      it('should reject non-pipe nodes', () => {
        const node: ArrowNode = {
          type: 'Arrow',
          parameter: 'x',
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isPipeNode(node)).toBe(false)
      })
    })

    describe('isArrowNode', () => {
      it('should identify arrow nodes', () => {
        const node: ArrowNode = {
          type: 'Arrow',
          parameter: 'x',
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isArrowNode(node)).toBe(true)
      })

      it('should reject non-arrow nodes', () => {
        const node: AssignNode = {
          type: 'Assign',
          field: 'x',
          value: { type: 'Literal', kind: 'string', value: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isArrowNode(node)).toBe(false)
      })
    })

    describe('isAssignNode', () => {
      it('should identify assign nodes', () => {
        const node: AssignNode = {
          type: 'Assign',
          field: 'x',
          value: { type: 'Literal', kind: 'string', value: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isAssignNode(node)).toBe(true)
      })

      it('should reject non-assign nodes', () => {
        const node: ArrowNode = {
          type: 'Arrow',
          parameter: 'x',
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        }

        expect(isAssignNode(node)).toBe(false)
      })
    })
  })

  describe('Type Unions', () => {
    it('should treat all nodes as ASTNode', () => {
      const nodes: ASTNode[] = [
        { type: 'Literal', kind: 'string', value: 'test', line: 1, column: 1 },
        { type: 'Identifier', name: 'foo', line: 1, column: 1 },
        { type: 'Root', line: 1, column: 1 },
        { type: 'This', line: 1, column: 1 },
        { type: 'Meta', line: 1, column: 1 },
        {
          type: 'BinaryOp',
          operator: '+',
          left: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
          right: { type: 'Literal', kind: 'number', value: 2, line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'UnaryOp',
          operator: '-',
          operand: { type: 'Literal', kind: 'number', value: 5, line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'MemberAccess',
          object: { type: 'Identifier', name: 'obj', line: 1, column: 1 },
          property: 'field',
          accessType: 'dot',
          line: 1,
          column: 1
        },
        {
          type: 'Call',
          function: { type: 'Identifier', name: 'foo', line: 1, column: 1 },
          arguments: [],
          line: 1,
          column: 1
        },
        { type: 'Array', elements: [], line: 1, column: 1 },
        { type: 'Object', fields: [], line: 1, column: 1 },
        {
          type: 'If',
          condition: { type: 'Literal', kind: 'boolean', value: true, line: 1, column: 1 },
          consequent: { type: 'Literal', kind: 'string', value: 'yes', line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'Match',
          input: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          cases: [],
          line: 1,
          column: 1
        },
        {
          type: 'Let',
          name: 'x',
          value: { type: 'Literal', kind: 'number', value: 1, line: 1, column: 1 },
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'Map',
          lambda: {
            type: 'Arrow',
            parameter: 'x',
            body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
            line: 1,
            column: 1
          },
          line: 1,
          column: 1
        },
        {
          type: 'Pipe',
          left: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          right: { type: 'Identifier', name: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'Arrow',
          parameter: 'x',
          body: { type: 'Identifier', name: 'x', line: 1, column: 1 },
          line: 1,
          column: 1
        },
        {
          type: 'Assign',
          field: 'x',
          value: { type: 'Literal', kind: 'string', value: 'y', line: 1, column: 1 },
          line: 1,
          column: 1
        }
      ]

      expect(nodes).toHaveLength(18)
      expect(nodes.every(n => n.line !== undefined && n.column !== undefined)).toBe(true)
    })
  })

  describe('Binary Operators', () => {
    it('should support all arithmetic operators', () => {
      const operators: BinaryOperator[] = ['+', '-', '*', '/', '%']

      expect(operators).toContain('+')
      expect(operators).toContain('-')
      expect(operators).toContain('*')
      expect(operators).toContain('/')
      expect(operators).toContain('%')
    })

    it('should support all comparison operators', () => {
      const operators: BinaryOperator[] = ['==', '!=', '<', '>', '<=', '>=']

      expect(operators).toContain('==')
      expect(operators).toContain('!=')
      expect(operators).toContain('<')
      expect(operators).toContain('>')
      expect(operators).toContain('<=')
      expect(operators).toContain('>=')
    })

    it('should support all logical operators', () => {
      const operators: BinaryOperator[] = ['&&', '||']

      expect(operators).toContain('&&')
      expect(operators).toContain('||')
    })
  })

  describe('Unary Operators', () => {
    it('should support negation operator', () => {
      const operators: UnaryOperator[] = ['-']
      expect(operators).toContain('-')
    })

    it('should support logical NOT operator', () => {
      const operators: UnaryOperator[] = ['!']
      expect(operators).toContain('!')
    })
  })

  describe('Access Types', () => {
    it('should support dot access', () => {
      const types: AccessType[] = ['dot']
      expect(types).toContain('dot')
    })

    it('should support bracket access', () => {
      const types: AccessType[] = ['bracket']
      expect(types).toContain('bracket')
    })

    it('should support optional chaining', () => {
      const types: AccessType[] = ['optional']
      expect(types).toContain('optional')
    })
  })
})
