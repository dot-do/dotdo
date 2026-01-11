/**
 * RED Phase: Bloblang Parser Tests
 * Issue: dotdo-0hqfx
 *
 * Comprehensive failing tests for the Bloblang parser.
 * Tests conversion of tokens to Abstract Syntax Tree (AST).
 *
 * Test categories:
 * 1. Literal expressions (strings, numbers, booleans, null)
 * 2. References (root, this, meta, identifiers)
 * 3. Binary operators with precedence
 * 4. Unary operators
 * 5. Member access (dot notation, bracket access, optional chaining)
 * 6. Function calls and method chaining
 * 7. Control flow (if/else, match)
 * 8. Variable binding (let)
 * 9. Mapping expressions and assignment
 * 10. Lambda/Arrow functions
 * 11. Array and object literals
 * 12. Error handling with line/column info
 */

import { describe, it, expect } from 'vitest'
import { Lexer } from '../lexer'
// Parser will be imported when implemented
// import { Parser, parse } from '../parser'

// Helper to create a parser instance and parse
// This will be implemented in parser.ts
// const parse = (source: string) => new Parser(new Lexer(source)).parse()

describe('Bloblang Parser - RED Phase', () => {
  describe('Literal Expressions', () => {
    it('parses string literals', () => {
      const parser = createParser('"hello"')
      const ast = parser.parse()
      expect(ast).toBeDefined()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('string')
      expect(ast.value).toBe('hello')
    })

    it('parses empty string literals', () => {
      const parser = createParser('""')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('string')
      expect(ast.value).toBe('')
    })

    it('parses string with escaped quotes', () => {
      const parser = createParser('"hello\\"world"')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.value).toBe('hello"world')
    })

    it('parses string with newlines', () => {
      const parser = createParser('"hello\\nworld"')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.value).toBe('hello\nworld')
    })

    it('parses single-quoted strings', () => {
      const parser = createParser("'hello'")
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('string')
      expect(ast.value).toBe('hello')
    })

    it('parses integer numbers', () => {
      const parser = createParser('42')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
      expect(ast.value).toBe(42)
    })

    it('parses float numbers', () => {
      const parser = createParser('3.14')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
      expect(ast.value).toBe(3.14)
    })

    it('parses negative numbers', () => {
      const parser = createParser('-42')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
      expect(ast.value).toBe(-42)
    })

    it('parses scientific notation', () => {
      const parser = createParser('1.5e10')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
      expect(ast.value).toBe(1.5e10)
    })

    it('parses zero', () => {
      const parser = createParser('0')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
      expect(ast.value).toBe(0)
    })

    it('parses true boolean', () => {
      const parser = createParser('true')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('boolean')
      expect(ast.value).toBe(true)
    })

    it('parses false boolean', () => {
      const parser = createParser('false')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('boolean')
      expect(ast.value).toBe(false)
    })

    it('parses null literal', () => {
      const parser = createParser('null')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('null')
      expect(ast.value).toBeNull()
    })
  })

  describe('References', () => {
    it('parses root reference', () => {
      const parser = createParser('root')
      const ast = parser.parse()
      expect(ast.type).toBe('Root')
    })

    it('parses this reference', () => {
      const parser = createParser('this')
      const ast = parser.parse()
      expect(ast.type).toBe('This')
    })

    it('parses meta reference', () => {
      const parser = createParser('meta')
      const ast = parser.parse()
      expect(ast.type).toBe('Meta')
    })

    it('parses simple identifier', () => {
      const parser = createParser('myVar')
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe('myVar')
    })

    it('parses identifier with underscores', () => {
      const parser = createParser('my_var_name')
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe('my_var_name')
    })

    it('parses identifier with numbers', () => {
      const parser = createParser('var123')
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe('var123')
    })

    it('includes line and column info in Root node', () => {
      const parser = createParser('root')
      const ast = parser.parse()
      expect(ast.line).toBe(1)
      expect(ast.column).toBe(1)
    })
  })

  describe('Binary Operators - Arithmetic', () => {
    it('parses addition', () => {
      const parser = createParser('1 + 2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
      expect(ast.left.type).toBe('Literal')
      expect(ast.left.value).toBe(1)
      expect(ast.right.type).toBe('Literal')
      expect(ast.right.value).toBe(2)
    })

    it('parses subtraction', () => {
      const parser = createParser('5 - 3')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('-')
      expect(ast.left.value).toBe(5)
      expect(ast.right.value).toBe(3)
    })

    it('parses multiplication', () => {
      const parser = createParser('4 * 5')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('*')
    })

    it('parses division', () => {
      const parser = createParser('10 / 2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('/')
    })

    it('parses modulo', () => {
      const parser = createParser('10 % 3')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('%')
    })

    it('respects operator precedence: multiplication before addition', () => {
      const parser = createParser('1 + 2 * 3')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
      expect(ast.left.value).toBe(1)
      expect(ast.right.type).toBe('BinaryOp')
      expect(ast.right.operator).toBe('*')
    })

    it('respects operator precedence: division before addition', () => {
      const parser = createParser('10 + 20 / 4')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
      expect(ast.right.operator).toBe('/')
    })

    it('respects operator precedence: left-to-right for same precedence', () => {
      const parser = createParser('10 - 5 - 2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('-')
      expect(ast.left.type).toBe('BinaryOp')
      expect(ast.left.operator).toBe('-')
    })

    it('parses multiple additions left-to-right', () => {
      const parser = createParser('1 + 2 + 3 + 4')
      const ast = parser.parse()
      // Should be ((1 + 2) + 3) + 4
      expect(ast.operator).toBe('+')
      expect(ast.left.operator).toBe('+')
      expect(ast.left.left.operator).toBe('+')
    })
  })

  describe('Binary Operators - Comparison', () => {
    it('parses equality', () => {
      const parser = createParser('a == b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('==')
    })

    it('parses inequality', () => {
      const parser = createParser('a != b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('!=')
    })

    it('parses less than', () => {
      const parser = createParser('a < b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('<')
    })

    it('parses greater than', () => {
      const parser = createParser('a > b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('>')
    })

    it('parses less than or equal', () => {
      const parser = createParser('a <= b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('<=')
    })

    it('parses greater than or equal', () => {
      const parser = createParser('a >= b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('>=')
    })

    it('comparison operators have lower precedence than arithmetic', () => {
      const parser = createParser('1 + 2 == 3')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('==')
      expect(ast.left.operator).toBe('+')
    })
  })

  describe('Binary Operators - Logical', () => {
    it('parses logical AND', () => {
      const parser = createParser('true && false')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('&&')
    })

    it('parses logical OR', () => {
      const parser = createParser('true || false')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('||')
    })

    it('AND has higher precedence than OR', () => {
      const parser = createParser('true || false && true')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('||')
      expect(ast.right.operator).toBe('&&')
    })

    it('logical operators have lower precedence than comparison', () => {
      const parser = createParser('a == b && c != d')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('&&')
      expect(ast.left.operator).toBe('==')
      expect(ast.right.operator).toBe('!=')
    })
  })

  describe('Unary Operators', () => {
    it('parses negation of number', () => {
      const parser = createParser('-42')
      const ast = parser.parse()
      expect(ast.type).toBe('UnaryOp')
      expect(ast.operator).toBe('-')
      expect(ast.operand.type).toBe('Literal')
      expect(ast.operand.value).toBe(42)
    })

    it('parses negation of identifier', () => {
      const parser = createParser('-x')
      const ast = parser.parse()
      expect(ast.type).toBe('UnaryOp')
      expect(ast.operator).toBe('-')
      expect(ast.operand.type).toBe('Identifier')
    })

    it('parses logical NOT', () => {
      const parser = createParser('!true')
      const ast = parser.parse()
      expect(ast.type).toBe('UnaryOp')
      expect(ast.operator).toBe('!')
      expect(ast.operand.value).toBe(true)
    })

    it('parses NOT of identifier', () => {
      const parser = createParser('!valid')
      const ast = parser.parse()
      expect(ast.type).toBe('UnaryOp')
      expect(ast.operator).toBe('!')
      expect(ast.operand.name).toBe('valid')
    })

    it('parses double negation', () => {
      const parser = createParser('--5')
      const ast = parser.parse()
      expect(ast.type).toBe('UnaryOp')
      expect(ast.operator).toBe('-')
      expect(ast.operand.type).toBe('UnaryOp')
      expect(ast.operand.operator).toBe('-')
    })

    it('unary NOT binds tighter than binary operators', () => {
      const parser = createParser('!a && b')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('&&')
      expect(ast.left.type).toBe('UnaryOp')
      expect(ast.left.operator).toBe('!')
    })
  })

  describe('Member Access - Dot Notation', () => {
    it('parses simple dot access', () => {
      const parser = createParser('root.name')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('dot')
      expect(ast.object.type).toBe('Root')
      expect(ast.property).toBe('name')
    })

    it('parses chained dot access', () => {
      const parser = createParser('root.user.name')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.property).toBe('name')
      expect(ast.object.type).toBe('MemberAccess')
      expect(ast.object.property).toBe('user')
    })

    it('parses dot access on identifier', () => {
      const parser = createParser('obj.field')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('dot')
      expect(ast.object.name).toBe('obj')
      expect(ast.property).toBe('field')
    })

    it('parses dot access on this', () => {
      const parser = createParser('this.value')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.object.type).toBe('This')
    })

    it('parses dot access on meta', () => {
      const parser = createParser('meta.id')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.object.type).toBe('Meta')
    })

    it('parses deeply nested dot access', () => {
      const parser = createParser('a.b.c.d.e')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.property).toBe('e')
      let current: any = ast.object
      expect(current.property).toBe('d')
      current = current.object
      expect(current.property).toBe('c')
      current = current.object
      expect(current.property).toBe('b')
    })
  })

  describe('Member Access - Bracket Notation', () => {
    it('parses simple bracket access with string key', () => {
      const parser = createParser('root["name"]')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('bracket')
      expect(ast.object.type).toBe('Root')
      expect(ast.property).toBe('name')
    })

    it('parses bracket access with single quotes', () => {
      const parser = createParser("root['name']")
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('bracket')
      expect(ast.property).toBe('name')
    })

    it('parses bracket access with numeric index', () => {
      const parser = createParser('arr[0]')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('bracket')
      expect(ast.property.type).toBe('Literal')
      expect(ast.property.value).toBe(0)
    })

    it('parses bracket access with expression', () => {
      const parser = createParser('arr[i + 1]')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('bracket')
      expect(ast.property.type).toBe('BinaryOp')
      expect(ast.property.operator).toBe('+')
    })

    it('parses chained bracket access', () => {
      const parser = createParser('root["data"][0]')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('bracket')
      expect(ast.object.type).toBe('MemberAccess')
      expect(ast.object.accessType).toBe('bracket')
    })
  })

  describe('Member Access - Optional Chaining', () => {
    it('parses optional dot access', () => {
      const parser = createParser('obj?.field')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('optional')
      expect(ast.property).toBe('field')
    })

    it('parses chained optional access', () => {
      const parser = createParser('root?.user?.name')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('optional')
      expect(ast.object.type).toBe('MemberAccess')
      expect(ast.object.accessType).toBe('optional')
    })

    it('parses mixed dot and optional access', () => {
      const parser = createParser('root.user?.email')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      expect(ast.accessType).toBe('optional')
      expect(ast.object.type).toBe('MemberAccess')
      expect(ast.object.accessType).toBe('dot')
    })
  })

  describe('Function Calls', () => {
    it('parses function call with no arguments', () => {
      const parser = createParser('func()')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.name).toBe('func')
      expect(ast.arguments).toHaveLength(0)
    })

    it('parses function call with single argument', () => {
      const parser = createParser('func(42)')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.name).toBe('func')
      expect(ast.arguments).toHaveLength(1)
      expect(ast.arguments[0].value).toBe(42)
    })

    it('parses function call with multiple arguments', () => {
      const parser = createParser('func(1, 2, 3)')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.arguments).toHaveLength(3)
      expect(ast.arguments[0].value).toBe(1)
      expect(ast.arguments[1].value).toBe(2)
      expect(ast.arguments[2].value).toBe(3)
    })

    it('parses function call with string arguments', () => {
      const parser = createParser('func("hello", "world")')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.arguments).toHaveLength(2)
      expect(ast.arguments[0].value).toBe('hello')
      expect(ast.arguments[1].value).toBe('world')
    })

    it('parses nested function calls', () => {
      const parser = createParser('outer(inner())')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.name).toBe('outer')
      expect(ast.arguments[0].type).toBe('Call')
      expect(ast.arguments[0].function.name).toBe('inner')
    })

    it('parses function call on member access', () => {
      const parser = createParser('obj.method()')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.type).toBe('MemberAccess')
      expect(ast.function.property).toBe('method')
    })

    it('parses method chaining', () => {
      const parser = createParser('func1().func2()')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.type).toBe('MemberAccess')
      expect(ast.function.object.type).toBe('Call')
    })
  })

  describe('Pipe Operator', () => {
    it('parses simple pipe', () => {
      const parser = createParser('root | func')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.left.type).toBe('Root')
      expect(ast.right.name).toBe('func')
    })

    it('parses pipe with function call', () => {
      const parser = createParser('root | func()')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.left.type).toBe('Root')
      expect(ast.right.type).toBe('Call')
    })

    it('parses chained pipes', () => {
      const parser = createParser('root | func1 | func2 | func3')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.right.name).toBe('func3')
      expect(ast.left.type).toBe('Pipe')
      expect(ast.left.right.name).toBe('func2')
    })

    it('parses pipe with member access', () => {
      const parser = createParser('root | this.field')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.right.type).toBe('MemberAccess')
    })

    it('pipes have lower precedence than member access', () => {
      const parser = createParser('root.user | func')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.left.type).toBe('MemberAccess')
    })
  })

  describe('Array Literals', () => {
    it('parses empty array', () => {
      const parser = createParser('[]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements).toHaveLength(0)
    })

    it('parses array with single element', () => {
      const parser = createParser('[1]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements).toHaveLength(1)
      expect(ast.elements[0].value).toBe(1)
    })

    it('parses array with multiple elements', () => {
      const parser = createParser('[1, 2, 3]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements).toHaveLength(3)
      expect(ast.elements[0].value).toBe(1)
      expect(ast.elements[1].value).toBe(2)
      expect(ast.elements[2].value).toBe(3)
    })

    it('parses array with mixed types', () => {
      const parser = createParser('[1, "hello", true, null]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements).toHaveLength(4)
      expect(ast.elements[0].value).toBe(1)
      expect(ast.elements[1].value).toBe('hello')
      expect(ast.elements[2].value).toBe(true)
      expect(ast.elements[3].value).toBeNull()
    })

    it('parses array with expressions', () => {
      const parser = createParser('[1 + 2, 3 * 4]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements).toHaveLength(2)
      expect(ast.elements[0].type).toBe('BinaryOp')
      expect(ast.elements[1].type).toBe('BinaryOp')
    })

    it('parses array with identifiers', () => {
      const parser = createParser('[x, y, z]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements[0].name).toBe('x')
      expect(ast.elements[1].name).toBe('y')
      expect(ast.elements[2].name).toBe('z')
    })

    it('parses nested arrays', () => {
      const parser = createParser('[[1, 2], [3, 4]]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      expect(ast.elements[0].type).toBe('Array')
      expect(ast.elements[1].type).toBe('Array')
    })
  })

  describe('Object Literals', () => {
    it('parses empty object', () => {
      const parser = createParser('{}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields).toHaveLength(0)
    })

    it('parses object with single field', () => {
      const parser = createParser('{name: "John"}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields).toHaveLength(1)
      expect(ast.fields[0].key).toBe('name')
      expect(ast.fields[0].value.value).toBe('John')
    })

    it('parses object with multiple fields', () => {
      const parser = createParser('{a: 1, b: 2, c: 3}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields).toHaveLength(3)
      expect(ast.fields[0].key).toBe('a')
      expect(ast.fields[0].value.value).toBe(1)
      expect(ast.fields[1].key).toBe('b')
      expect(ast.fields[2].key).toBe('c')
    })

    it('parses object with quoted keys', () => {
      const parser = createParser('{"key-name": "value"}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields[0].key).toBe('key-name')
    })

    it('parses object with expression values', () => {
      const parser = createParser('{result: 1 + 2}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields[0].value.type).toBe('BinaryOp')
    })

    it('parses object with identifier values', () => {
      const parser = createParser('{field: myVar}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields[0].value.name).toBe('myVar')
    })

    it('parses object with member access values', () => {
      const parser = createParser('{data: root.field}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields[0].value.type).toBe('MemberAccess')
    })

    it('parses nested objects', () => {
      const parser = createParser('{outer: {inner: 42}}')
      const ast = parser.parse()
      expect(ast.type).toBe('Object')
      expect(ast.fields[0].value.type).toBe('Object')
    })
  })

  describe('If-Else Expressions', () => {
    it('parses simple if expression', () => {
      const parser = createParser('if true then 1 else 2')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.condition.value).toBe(true)
      expect(ast.consequent.value).toBe(1)
      expect(ast.alternate.value).toBe(2)
    })

    it('parses if with identifier condition', () => {
      const parser = createParser('if valid then "yes" else "no"')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.condition.name).toBe('valid')
      expect(ast.consequent.value).toBe('yes')
      expect(ast.alternate.value).toBe('no')
    })

    it('parses if with comparison condition', () => {
      const parser = createParser('if a > b then "greater" else "less"')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.condition.type).toBe('BinaryOp')
      expect(ast.condition.operator).toBe('>')
    })

    it('parses if with complex consequent', () => {
      const parser = createParser('if x then a + b else c')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.consequent.type).toBe('BinaryOp')
    })

    it('parses nested if expressions', () => {
      const parser = createParser('if a then if b then 1 else 2 else 3')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.consequent.type).toBe('If')
    })

    it('parses if without else (should default to null or nothing)', () => {
      const parser = createParser('if true then 1')
      const ast = parser.parse()
      expect(ast.type).toBe('If')
      expect(ast.consequent.value).toBe(1)
      // alternate may be null or undefined depending on implementation
    })
  })

  describe('Match Expressions', () => {
    it('parses simple match expression', () => {
      const parser = createParser('match x { case 1: "one" }')
      const ast = parser.parse()
      expect(ast.type).toBe('Match')
      expect(ast.input.name).toBe('x')
      expect(ast.cases).toHaveLength(1)
      expect(ast.cases[0].pattern.value).toBe(1)
      expect(ast.cases[0].body.value).toBe('one')
    })

    it('parses match with multiple cases', () => {
      const parser = createParser('match x { case 1: "one" case 2: "two" case 3: "three" }')
      const ast = parser.parse()
      expect(ast.type).toBe('Match')
      expect(ast.cases).toHaveLength(3)
    })

    it('parses match with default case', () => {
      const parser = createParser('match x { case 1: "one" default: "other" }')
      const ast = parser.parse()
      expect(ast.type).toBe('Match')
      expect(ast.default).toBeDefined()
      expect(ast.default.value).toBe('other')
    })

    it('parses match with complex patterns', () => {
      const parser = createParser('match root { case root.type == "user": "is user" }')
      const ast = parser.parse()
      expect(ast.type).toBe('Match')
      expect(ast.cases[0].pattern.type).toBe('BinaryOp')
    })

    it('parses match with expression bodies', () => {
      const parser = createParser('match x { case 1: a + b case 2: c * d }')
      const ast = parser.parse()
      expect(ast.type).toBe('Match')
      expect(ast.cases[0].body.type).toBe('BinaryOp')
      expect(ast.cases[1].body.type).toBe('BinaryOp')
    })
  })

  describe('Let Bindings', () => {
    it('parses simple let binding', () => {
      const parser = createParser('let x = 5 in x + 1')
      const ast = parser.parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.value.value).toBe(5)
      expect(ast.body.type).toBe('BinaryOp')
    })

    it('parses let with identifier value', () => {
      const parser = createParser('let x = y in x')
      const ast = parser.parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.value.name).toBe('y')
    })

    it('parses let with complex value expression', () => {
      const parser = createParser('let result = a + b * c in result')
      const ast = parser.parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
    })

    it('parses nested let bindings', () => {
      const parser = createParser('let x = 1 in let y = 2 in x + y')
      const ast = parser.parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Let')
    })

    it('parses let with member access', () => {
      const parser = createParser('let user = root.user in user.name')
      const ast = parser.parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('MemberAccess')
      expect(ast.body.type).toBe('MemberAccess')
    })
  })

  describe('Lambda/Arrow Functions', () => {
    it('parses simple arrow function', () => {
      const parser = createParser('x -> x + 1')
      const ast = parser.parse()
      expect(ast.type).toBe('Arrow')
      expect(ast.parameter).toBe('x')
      expect(ast.body.type).toBe('BinaryOp')
    })

    it('parses arrow with identifier body', () => {
      const parser = createParser('x -> x')
      const ast = parser.parse()
      expect(ast.type).toBe('Arrow')
      expect(ast.parameter).toBe('x')
      expect(ast.body.name).toBe('x')
    })

    it('parses arrow with complex expression', () => {
      const parser = createParser('item -> item.name + item.value')
      const ast = parser.parse()
      expect(ast.type).toBe('Arrow')
      expect(ast.parameter).toBe('item')
      expect(ast.body.type).toBe('BinaryOp')
    })

    it('parses nested arrow functions', () => {
      const parser = createParser('x -> y -> x + y')
      const ast = parser.parse()
      expect(ast.type).toBe('Arrow')
      expect(ast.parameter).toBe('x')
      expect(ast.body.type).toBe('Arrow')
      expect(ast.body.parameter).toBe('y')
    })

    it('parses arrow with member access', () => {
      const parser = createParser('obj -> obj.field')
      const ast = parser.parse()
      expect(ast.type).toBe('Arrow')
      expect(ast.body.type).toBe('MemberAccess')
    })
  })

  describe('Map Expression', () => {
    it('parses map with lambda', () => {
      const parser = createParser('map(x -> x + 1)')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.function.name).toBe('map')
      expect(ast.arguments[0].type).toBe('Arrow')
    })

    it('parses map with complex lambda body', () => {
      const parser = createParser('map(item -> item.name)')
      const ast = parser.parse()
      expect(ast.type).toBe('Call')
      expect(ast.arguments[0].body.type).toBe('MemberAccess')
    })
  })

  describe('Assignment (Field Mapping)', () => {
    it('parses simple field assignment', () => {
      const parser = createParser('foo = bar')
      const ast = parser.parse()
      expect(ast.type).toBe('Assign')
      expect(ast.field).toBe('foo')
      expect(ast.value.name).toBe('bar')
    })

    it('parses assignment with literal value', () => {
      const parser = createParser('name = "John"')
      const ast = parser.parse()
      expect(ast.type).toBe('Assign')
      expect(ast.field).toBe('name')
      expect(ast.value.value).toBe('John')
    })

    it('parses assignment with expression', () => {
      const parser = createParser('total = a + b')
      const ast = parser.parse()
      expect(ast.type).toBe('Assign')
      expect(ast.value.type).toBe('BinaryOp')
    })

    it('parses assignment with member access', () => {
      const parser = createParser('output = root.data')
      const ast = parser.parse()
      expect(ast.type).toBe('Assign')
      expect(ast.value.type).toBe('MemberAccess')
    })

    it('parses assignment with function call', () => {
      const parser = createParser('result = func()')
      const ast = parser.parse()
      expect(ast.type).toBe('Assign')
      expect(ast.value.type).toBe('Call')
    })
  })

  describe('Complex Expressions', () => {
    it('parses complex arithmetic with operator precedence', () => {
      const parser = createParser('2 + 3 * 4 - 5 / 2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('-')
      // Left side should be 2 + 3 * 4
      expect(ast.left.type).toBe('BinaryOp')
      expect(ast.left.operator).toBe('+')
    })

    it('parses parenthesized expression', () => {
      const parser = createParser('(2 + 3) * 4')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('*')
      expect(ast.left.type).toBe('BinaryOp')
      expect(ast.left.operator).toBe('+')
    })

    it('parses complex condition with logical operators', () => {
      const parser = createParser('a > b && c < d || e == f')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('||')
      expect(ast.left.operator).toBe('&&')
    })

    it('parses member access with function call and arithmetic', () => {
      const parser = createParser('root.items[0].price * quantity')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('*')
      expect(ast.left.type).toBe('MemberAccess')
    })

    it('parses pipe with member access and function call', () => {
      const parser = createParser('root | this.items | map(x -> x.id)')
      const ast = parser.parse()
      expect(ast.type).toBe('Pipe')
      expect(ast.right.type).toBe('Call')
      expect(ast.right.arguments[0].type).toBe('Arrow')
    })
  })

  describe('Whitespace and Formatting', () => {
    it('handles extra whitespace', () => {
      const parser = createParser('  1   +   2  ')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
    })

    it('handles no whitespace', () => {
      const parser = createParser('1+2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
    })

    it('handles tabs and mixed whitespace', () => {
      const parser = createParser('1\t+\t2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
    })
  })

  describe('Comments', () => {
    it('ignores comments to end of line', () => {
      const parser = createParser('1 + 2 # this is a comment')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
    })

    it('handles multiple comment lines', () => {
      const parser = createParser('1 # comment 1\n + # comment 2\n 2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
    })
  })

  describe('Error Handling - Location Info', () => {
    it('tracks line and column for Root node', () => {
      const parser = createParser('root')
      const ast = parser.parse()
      expect(ast.line).toBe(1)
      expect(ast.column).toBe(1)
    })

    it('tracks line and column for Literal node', () => {
      const parser = createParser('   42')
      const ast = parser.parse()
      expect(ast.line).toBe(1)
      // Column should account for leading spaces
      expect(ast.column).toBeGreaterThanOrEqual(1)
    })

    it('tracks line and column for BinaryOp node', () => {
      const parser = createParser('1 + 2')
      const ast = parser.parse()
      expect(ast.line).toBe(1)
      expect(ast.column).toBeGreaterThanOrEqual(1)
    })

    it('tracks line numbers across multiple lines', () => {
      const parser = createParser('1 +\n2')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.right.line).toBe(2)
    })

    it('throws error on unexpected token', () => {
      const parser = createParser('1 + + 2')
      expect(() => parser.parse()).toThrow()
    })

    it('throws error on unmatched parenthesis', () => {
      const parser = createParser('(1 + 2')
      expect(() => parser.parse()).toThrow()
    })

    it('throws error on unmatched bracket', () => {
      const parser = createParser('[1, 2')
      expect(() => parser.parse()).toThrow()
    })

    it('throws error on unmatched brace', () => {
      const parser = createParser('{a: 1')
      expect(() => parser.parse()).toThrow()
    })

    it('error includes line information', () => {
      const parser = createParser('1 +\n2 +')
      try {
        parser.parse()
        fail('Should have thrown error')
      } catch (error: any) {
        expect(error.line).toBeDefined()
        expect(error.column).toBeDefined()
      }
    })
  })

  describe('Edge Cases', () => {
    it('parses identifier that starts with underscore', () => {
      const parser = createParser('_private')
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe('_private')
    })

    it('parses identifier with single character', () => {
      const parser = createParser('x')
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe('x')
    })

    it('parses very long identifier', () => {
      const longName = 'a'.repeat(100)
      const parser = createParser(longName)
      const ast = parser.parse()
      expect(ast.type).toBe('Identifier')
      expect(ast.name).toBe(longName)
    })

    it('parses deeply nested member access', () => {
      const parser = createParser('a.b.c.d.e.f.g.h.i.j')
      const ast = parser.parse()
      expect(ast.type).toBe('MemberAccess')
      let depth = 1
      let current: any = ast.object
      while (current.type === 'MemberAccess') {
        depth++
        current = current.object
      }
      expect(depth).toBe(9)
    })

    it('parses deeply nested array literal', () => {
      const parser = createParser('[[[[[1]]]]]')
      const ast = parser.parse()
      expect(ast.type).toBe('Array')
      let depth = 1
      let current: any = ast.elements[0]
      while (current.type === 'Array') {
        depth++
        current = current.elements[0]
      }
      expect(depth).toBe(5)
    })

    it('parses empty expressions (if supported)', () => {
      // Some parsers may support empty expressions as null/nothing
      try {
        const parser = createParser('')
        const ast = parser.parse()
        // Should either return null node or throw error
        expect(ast).toBeDefined()
      } catch {
        // Expected - empty input may be an error
      }
    })

    it('parses zero as number not operator', () => {
      const parser = createParser('0')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.value).toBe(0)
    })

    it('parses large numbers', () => {
      const parser = createParser('999999999999999')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.kind).toBe('number')
    })

    it('parses string with special characters', () => {
      const parser = createParser('"!@#$%^&*()"')
      const ast = parser.parse()
      expect(ast.type).toBe('Literal')
      expect(ast.value).toBe('!@#$%^&*()')
    })
  })

  describe('Operator Precedence (Comprehensive)', () => {
    it('logical OR has lowest precedence', () => {
      const parser = createParser('a && b || c && d')
      const ast = parser.parse()
      expect(ast.operator).toBe('||')
      expect(ast.left.operator).toBe('&&')
      expect(ast.right.operator).toBe('&&')
    })

    it('comparison operators bind tighter than logical', () => {
      const parser = createParser('a == b && c > d')
      const ast = parser.parse()
      expect(ast.operator).toBe('&&')
      expect(ast.left.operator).toBe('==')
      expect(ast.right.operator).toBe('>')
    })

    it('arithmetic binds tighter than comparison', () => {
      const parser = createParser('a + b == c * d')
      const ast = parser.parse()
      expect(ast.operator).toBe('==')
      expect(ast.left.operator).toBe('+')
      expect(ast.right.operator).toBe('*')
    })

    it('multiplication binds tighter than addition', () => {
      const parser = createParser('a + b * c + d')
      const ast = parser.parse()
      expect(ast.operator).toBe('+')
      expect(ast.left.operator).toBe('+')
      expect(ast.left.right.operator).toBe('*')
    })

    it('modulo has same precedence as multiplication', () => {
      const parser = createParser('a * b % c')
      const ast = parser.parse()
      expect(ast.type).toBe('BinaryOp')
      // Should be (a * b) % c due to left-to-right associativity
      expect(ast.operator).toBe('%')
      expect(ast.left.operator).toBe('*')
    })

    it('unary operators bind tighter than binary', () => {
      const parser = createParser('-a + b')
      const ast = parser.parse()
      expect(ast.operator).toBe('+')
      expect(ast.left.type).toBe('UnaryOp')
      expect(ast.right.name).toBe('b')
    })
  })
})

// Helper function to create a parser instance
function createParser(source: string): any {
  // This will be properly defined once Parser is implemented
  // For now, this is a placeholder that will fail the tests
  return {
    parse: () => {
      throw new Error('Parser not yet implemented')
    }
  }
}
