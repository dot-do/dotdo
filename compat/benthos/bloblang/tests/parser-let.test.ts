/**
 * Parser Let Expression Tests
 * Issue: dotdo-vdzjv
 *
 * Comprehensive tests for let expression parsing behavior.
 * This documents the current behavior before refactoring the duplicated
 * parseLetOr(), parseLetAnd(), parseLetComparison() functions.
 *
 * Key difference between let-context and standard-context parsing:
 * - Standard context: TokenType.IN is a comparison operator ("value in array")
 * - Let context: TokenType.IN is reserved as the keyword separator ("let x = val in body")
 *
 * The duplication exists to exclude IN from comparison operators in let value expressions.
 */

import { describe, it, expect } from 'vitest'
import { Lexer } from '../lexer'
import { Parser, createParser } from '../parser'

describe('Let Expression Parsing', () => {
  describe('Basic Let Expressions', () => {
    it('parses simple let with literal value', () => {
      const ast = createParser('let x = 5 in x').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.value.type).toBe('Literal')
      expect(ast.value.value).toBe(5)
      expect(ast.body.type).toBe('Identifier')
      expect(ast.body.name).toBe('x')
    })

    it('parses let with string value', () => {
      const ast = createParser('let name = "hello" in name').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Literal')
      expect(ast.value.value).toBe('hello')
    })

    it('parses let with boolean value', () => {
      const ast = createParser('let flag = true in flag').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.value).toBe(true)
    })

    it('parses let with null value', () => {
      const ast = createParser('let empty = null in empty').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.value).toBeNull()
    })

    it('parses let with identifier value', () => {
      const ast = createParser('let alias = original in alias').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Identifier')
      expect(ast.value.name).toBe('original')
    })
  })

  describe('Let with Logical Operators (||)', () => {
    it('parses let with OR in value', () => {
      const ast = createParser('let result = a || b in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('||')
    })

    it('parses let with chained OR in value', () => {
      const ast = createParser('let result = a || b || c in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('||')
      // Left-associative: ((a || b) || c)
      expect(ast.value.left.type).toBe('BinaryOp')
      expect(ast.value.left.operator).toBe('||')
    })

    it('parses let with OR in body', () => {
      const ast = createParser('let x = 1 in x || y').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('BinaryOp')
      expect(ast.body.operator).toBe('||')
    })

    it('parses let with OR in both value and body', () => {
      const ast = createParser('let cond = a || b in cond || c').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('||')
      expect(ast.body.operator).toBe('||')
    })
  })

  describe('Let with Logical Operators (&&)', () => {
    it('parses let with AND in value', () => {
      const ast = createParser('let result = a && b in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('&&')
    })

    it('parses let with chained AND in value', () => {
      const ast = createParser('let result = a && b && c in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('&&')
      expect(ast.value.left.operator).toBe('&&')
    })

    it('parses let with mixed AND/OR respecting precedence', () => {
      // AND binds tighter than OR
      const ast = createParser('let result = a || b && c in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('||')
      expect(ast.value.right.operator).toBe('&&')
    })

    it('parses let with AND/OR in complex expression', () => {
      const ast = createParser('let r = a && b || c && d in r').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('||')
      expect(ast.value.left.operator).toBe('&&')
      expect(ast.value.right.operator).toBe('&&')
    })
  })

  describe('Let with Equality Operators (==, !=)', () => {
    it('parses let with equality check', () => {
      const ast = createParser('let eq = a == b in eq').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('==')
    })

    it('parses let with inequality check', () => {
      const ast = createParser('let neq = a != b in neq').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
      expect(ast.value.operator).toBe('!=')
    })

    it('parses let with chained equality', () => {
      // Note: chained equality is left-associative: (a == b) == c
      const ast = createParser('let result = a == b == c in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('==')
      expect(ast.value.left.operator).toBe('==')
    })

    it('parses let with equality and logical operators', () => {
      // Equality binds tighter than logical
      const ast = createParser('let r = a == b && c != d in r').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('&&')
      expect(ast.value.left.operator).toBe('==')
      expect(ast.value.right.operator).toBe('!=')
    })
  })

  describe('Let with Comparison Operators (<, >, <=, >=)', () => {
    it('parses let with less than', () => {
      const ast = createParser('let lt = a < b in lt').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('<')
    })

    it('parses let with greater than', () => {
      const ast = createParser('let gt = a > b in gt').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('>')
    })

    it('parses let with less than or equal', () => {
      const ast = createParser('let lte = a <= b in lte').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('<=')
    })

    it('parses let with greater than or equal', () => {
      const ast = createParser('let gte = a >= b in gte').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('>=')
    })

    it('parses let with chained comparisons', () => {
      const ast = createParser('let result = a < b < c in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('<')
      expect(ast.value.left.operator).toBe('<')
    })

    it('parses let with comparison and equality', () => {
      // Comparison and equality have same-ish precedence area
      const ast = createParser('let r = a < b == c > d in r').parse()
      expect(ast.type).toBe('Let')
      // Structure depends on exact precedence rules
      expect(ast.value.type).toBe('BinaryOp')
    })
  })

  describe('Let with Arithmetic Operators (+, -, *, /, %)', () => {
    it('parses let with addition', () => {
      const ast = createParser('let sum = a + b in sum').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('+')
    })

    it('parses let with subtraction', () => {
      const ast = createParser('let diff = a - b in diff').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('-')
    })

    it('parses let with multiplication', () => {
      const ast = createParser('let prod = a * b in prod').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('*')
    })

    it('parses let with division', () => {
      const ast = createParser('let quot = a / b in quot').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('/')
    })

    it('parses let with modulo', () => {
      const ast = createParser('let mod = a % b in mod').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('%')
    })

    it('parses let with operator precedence: * before +', () => {
      const ast = createParser('let r = a + b * c in r').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('+')
      expect(ast.value.right.operator).toBe('*')
    })

    it('parses let with complex arithmetic', () => {
      const ast = createParser('let r = a * b + c / d - e % f in r').parse()
      expect(ast.type).toBe('Let')
      // (((a * b) + (c / d)) - (e % f))
      expect(ast.value.operator).toBe('-')
    })
  })

  describe('IN Operator Context Sensitivity', () => {
    /**
     * CRITICAL: The IN operator is handled differently:
     * - In standard expressions: "x in arr" is membership check
     * - In let value: "in" is the keyword separator
     *
     * This is why parseLetComparison() exists - it excludes TokenType.IN
     */

    it('IN keyword separates let value from body', () => {
      const ast = createParser('let x = 5 in x + 1').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.value.value).toBe(5)
      expect(ast.body.type).toBe('BinaryOp')
    })

    it('IN operator works in let body (standard expression context)', () => {
      const ast = createParser('let arr = [1,2,3] in 2 in arr').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('BinaryOp')
      expect(ast.body.operator).toBe('in')
    })

    it('IN as identifier keyword is recognized after value', () => {
      // The word "in" after the value expression is the keyword, not operator
      const ast = createParser('let val = 10 in val').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('val')
    })

    it('handles ambiguous case: comparison followed by in keyword', () => {
      // "let x = a < b in x" - the "in" here is keyword, not operator
      const ast = createParser('let x = a < b in x').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('<')
      expect(ast.body.type).toBe('Identifier')
    })

    it('distinguishes in keyword from identifier named in context', () => {
      // If we have a variable named "input" or similar
      const ast = createParser('let x = input in x').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Identifier')
      expect(ast.value.name).toBe('input')
    })
  })

  describe('Nested Let Expressions', () => {
    it('parses nested let in body', () => {
      const ast = createParser('let x = 1 in let y = 2 in x + y').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.body.type).toBe('Let')
      expect(ast.body.name).toBe('y')
      expect(ast.body.body.type).toBe('BinaryOp')
    })

    it('parses deeply nested let expressions', () => {
      const ast = createParser('let a = 1 in let b = 2 in let c = 3 in a + b + c').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Let')
      expect(ast.body.body.type).toBe('Let')
      expect(ast.body.body.body.type).toBe('BinaryOp')
    })

    it('nested let with operators at each level', () => {
      const ast = createParser('let x = 1 + 2 in let y = x * 3 in y - 1').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('+')
      expect(ast.body.type).toBe('Let')
      expect(ast.body.value.operator).toBe('*')
      expect(ast.body.body.operator).toBe('-')
    })

    it('let in parenthesized expression', () => {
      const ast = createParser('(let x = 5 in x) + 1').parse()
      expect(ast.type).toBe('BinaryOp')
      expect(ast.operator).toBe('+')
      expect(ast.left.type).toBe('Let')
    })
  })

  describe('Let with Function Calls', () => {
    it('parses let with function call as value', () => {
      const ast = createParser('let result = func() in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
    })

    it('parses let with function call with arguments', () => {
      const ast = createParser('let result = add(1, 2) in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
      expect(ast.value.arguments).toHaveLength(2)
    })

    it('parses let with nested function calls', () => {
      const ast = createParser('let result = outer(inner()) in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
      expect(ast.value.arguments[0].type).toBe('Call')
    })

    it('parses let with function call in body', () => {
      const ast = createParser('let x = 5 in process(x)').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Call')
    })

    it('parses let with function call using variable', () => {
      const ast = createParser('let arr = [1,2,3] in map(arr, x -> x + 1)').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Call')
    })
  })

  describe('Let with Method Chains', () => {
    it('parses let with method chain as value', () => {
      const ast = createParser('let result = obj.method() in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
      expect(ast.value.function.type).toBe('MemberAccess')
    })

    it('parses let with chained methods', () => {
      const ast = createParser('let result = obj.a().b().c() in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
    })

    it('parses let with member access in value', () => {
      const ast = createParser('let name = user.profile.name in name').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('MemberAccess')
    })

    it('parses let with method chain in body', () => {
      const ast = createParser('let data = root in data.items.map(x -> x.id)').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Call')
    })

    it('parses let with bracket access', () => {
      const ast = createParser('let item = arr[0] in item').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('MemberAccess')
      expect(ast.value.accessType).toBe('bracket')
    })

    it('parses let with optional chaining', () => {
      const ast = createParser('let name = user?.profile?.name in name').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('MemberAccess')
      expect(ast.value.accessType).toBe('optional')
    })
  })

  describe('Let with Array and Object Literals', () => {
    it('parses let with array literal value', () => {
      const ast = createParser('let arr = [1, 2, 3] in arr').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Array')
      expect(ast.value.elements).toHaveLength(3)
    })

    it('parses let with object literal value', () => {
      const ast = createParser('let obj = {a: 1, b: 2} in obj').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Object')
      expect(ast.value.fields).toHaveLength(2)
    })

    it('parses let with nested array', () => {
      const ast = createParser('let matrix = [[1,2],[3,4]] in matrix').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Array')
      expect(ast.value.elements[0].type).toBe('Array')
    })

    it('parses let with nested object', () => {
      const ast = createParser('let data = {user: {name: "test"}} in data').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Object')
      expect(ast.value.fields[0].value.type).toBe('Object')
    })

    it('parses let with expressions in array', () => {
      const ast = createParser('let arr = [a + 1, b * 2] in arr').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.elements[0].type).toBe('BinaryOp')
    })
  })

  describe('Let with Arrow Functions', () => {
    /**
     * NOTE: Arrow functions as direct let values don't work because
     * parseLetValue() uses parseLetOr() which doesn't include arrow parsing.
     * The arrow must be wrapped in parentheses or passed to a function.
     *
     * This is a limitation of the current parser that the refactor could fix.
     */

    it('arrow function as direct let value throws (parser limitation)', () => {
      // Direct arrow as value doesn't work - parseLetValue doesn't handle arrows
      expect(() => createParser('let fn = x -> x + 1 in fn').parse()).toThrow()
    })

    it('parses let with arrow wrapped in parentheses', () => {
      // Workaround: wrap arrow in parentheses
      const ast = createParser('let fn = (x -> x + 1) in fn').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Arrow')
      expect(ast.value.parameter).toBe('x')
    })

    it('parses let with arrow in function call', () => {
      const ast = createParser('let mapped = map(x -> x * 2) in mapped').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Call')
      expect(ast.value.arguments[0].type).toBe('Arrow')
    })

    it('nested arrow as direct value throws (parser limitation)', () => {
      // Direct nested arrow doesn't work
      expect(() => createParser('let fn = x -> y -> x + y in fn').parse()).toThrow()
    })

    it('parses let with nested arrow wrapped in parens', () => {
      const ast = createParser('let fn = (x -> y -> x + y) in fn').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Arrow')
      expect(ast.value.body.type).toBe('Arrow')
    })
  })

  describe('Let with If Expressions', () => {
    it('parses let with if expression in body', () => {
      const ast = createParser('let x = 5 in if x > 3 then "big" else "small"').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('If')
    })

    it('parses if with let in consequent', () => {
      const ast = createParser('if true then let x = 1 in x else 0').parse()
      expect(ast.type).toBe('If')
      expect(ast.consequent.type).toBe('Let')
    })

    it('if as direct let value treats "in result" as identifier (parser limitation)', () => {
      /**
       * This is a quirk: "let result = if cond then a else b in result"
       * The parser sees "if cond then a else b" which contains "in" from the else branch
       * but since if uses parseOr() for branches, the "in result" at the end
       * gets consumed differently.
       *
       * The current behavior: if's else branch captures "b" and stops,
       * then "in" keyword triggers let body, but "result" is the body.
       * Actually it returns Assign because if consumes too much.
       */
      const ast = createParser('let result = if cond then a else b in result').parse()
      // Due to parsing complexity, this becomes a statement-style let (Assign)
      expect(ast.type).toBe('Assign')
      expect(ast.field).toBe('$result')
    })

    it('parses let with if value wrapped in parens', () => {
      // Workaround: wrap if in parentheses
      const ast = createParser('let result = (if cond then a else b) in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('If')
    })
  })

  describe('Let with Pipe Expressions', () => {
    it('parses let with pipe in body', () => {
      const ast = createParser('let data = root in data | process').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Pipe')
    })

    it('parses let with chained pipes in body', () => {
      const ast = createParser('let x = root in x | a | b | c').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Pipe')
    })
  })

  describe('Let Statement Style (Variable Declaration)', () => {
    /**
     * Let can also be used in statement style: let x = val;
     * This creates an Assign node with $ prefix (variable declaration)
     */

    it('parses let statement without in keyword', () => {
      const ast = createParser('let x = 5').parse()
      // Statement style returns Assign with $ prefix
      expect(ast.type).toBe('Assign')
      expect(ast.field).toBe('$x')
      expect(ast.value.value).toBe(5)
    })

    it('parses let statement with expression value', () => {
      const ast = createParser('let sum = 1 + 2').parse()
      expect(ast.type).toBe('Assign')
      expect(ast.field).toBe('$sum')
      expect(ast.value.type).toBe('BinaryOp')
    })

    it('differentiates let statement from let expression', () => {
      // Without "in", it's a statement
      const stmt = createParser('let x = 5').parse()
      expect(stmt.type).toBe('Assign')

      // With "in", it's an expression
      const expr = createParser('let x = 5 in x').parse()
      expect(expr.type).toBe('Let')
    })
  })

  describe('Let Scope Verification', () => {
    it('variable is available in body', () => {
      const ast = createParser('let x = 5 in x + 1').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.left.name).toBe('x')
    })

    it('outer variable available in nested let', () => {
      const ast = createParser('let x = 1 in let y = x + 1 in y').parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.value.left.name).toBe('x')
    })

    it('inner variable shadows outer in nested let', () => {
      const ast = createParser('let x = 1 in let x = 2 in x').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('x')
      expect(ast.body.name).toBe('x') // inner x shadows
    })
  })

  describe('Error Handling Consistency', () => {
    it('throws on missing variable name', () => {
      expect(() => createParser('let = 5 in x').parse()).toThrow()
    })

    it('throws on missing equals sign', () => {
      expect(() => createParser('let x 5 in x').parse()).toThrow()
    })

    it('throws on missing value', () => {
      expect(() => createParser('let x = in x').parse()).toThrow()
    })

    it('throws on invalid operator in value', () => {
      expect(() => createParser('let x = + + in x').parse()).toThrow()
    })

    it('handles unbalanced parentheses in value', () => {
      expect(() => createParser('let x = (1 + 2 in x').parse()).toThrow()
    })

    it('handles unbalanced brackets in value', () => {
      expect(() => createParser('let x = [1, 2 in x').parse()).toThrow()
    })

    it('provides line/column info in errors', () => {
      try {
        createParser('let x = + in x').parse()
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.line).toBeDefined()
        expect(error.column).toBeDefined()
      }
    })
  })

  describe('Complex Combined Expressions', () => {
    it('parses let with all operator types', () => {
      const ast = createParser('let r = a + b * c > d && e || f in r').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('BinaryOp')
    })

    it('parses let with arithmetic, comparison, and logical', () => {
      const ast = createParser('let valid = x > 0 && x < 100 in valid').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('&&')
      expect(ast.value.left.operator).toBe('>')
      expect(ast.value.right.operator).toBe('<')
    })

    it('parses let with member access and operators', () => {
      const ast = createParser('let check = user.age >= 18 && user.active in check').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('&&')
    })

    it('parses let with function call and operators', () => {
      const ast = createParser('let result = len(arr) > 0 && contains(arr, x) in result').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.operator).toBe('&&')
      expect(ast.value.left.left.type).toBe('Call')
    })

    it('parses let with everything combined', () => {
      const code = 'let data = root.items in let filtered = data.filter(x -> x.active) in filtered.length > 0'
      const ast = createParser(code).parse()
      expect(ast.type).toBe('Let')
      expect(ast.body.type).toBe('Let')
      expect(ast.body.body.type).toBe('BinaryOp')
    })
  })

  describe('Edge Cases', () => {
    it('handles whitespace around in keyword', () => {
      const ast = createParser('let x = 5   in   x').parse()
      expect(ast.type).toBe('Let')
    })

    it('handles newlines in let expression', () => {
      const code = `let x = 5
      in x + 1`
      const ast = createParser(code).parse()
      expect(ast.type).toBe('Let')
    })

    it('handles single character variable name', () => {
      const ast = createParser('let a = 1 in a').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('a')
    })

    it('handles underscore variable name', () => {
      const ast = createParser('let _private = 1 in _private').parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe('_private')
    })

    it('handles long variable name', () => {
      const longName = 'a'.repeat(50)
      const ast = createParser(`let ${longName} = 1 in ${longName}`).parse()
      expect(ast.type).toBe('Let')
      expect(ast.name).toBe(longName)
    })

    it('parses let with root reference', () => {
      const ast = createParser('let data = root in data').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Root')
    })

    it('parses let with this reference', () => {
      const ast = createParser('let current = this in current').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('This')
    })

    it('parses let with meta reference', () => {
      const ast = createParser('let metadata = meta in metadata').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Meta')
    })

    it('parses let with nothing value', () => {
      const ast = createParser('let empty = nothing in empty').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Nothing')
    })

    it('parses let with deleted value', () => {
      const ast = createParser('let removed = deleted in removed').parse()
      expect(ast.type).toBe('Let')
      expect(ast.value.type).toBe('Deleted')
    })
  })

  describe('Operator Precedence in Let Context', () => {
    /**
     * These tests verify that operator precedence is consistent
     * between let-context parsing and standard-context parsing
     */

    it('OR has lowest precedence in let value', () => {
      const ast = createParser('let r = a && b || c && d in r').parse()
      expect(ast.value.operator).toBe('||')
      expect(ast.value.left.operator).toBe('&&')
      expect(ast.value.right.operator).toBe('&&')
    })

    it('AND binds tighter than OR in let value', () => {
      const ast = createParser('let r = a || b && c in r').parse()
      expect(ast.value.operator).toBe('||')
      expect(ast.value.right.operator).toBe('&&')
    })

    it('equality binds tighter than logical in let value', () => {
      const ast = createParser('let r = a == b && c != d in r').parse()
      expect(ast.value.operator).toBe('&&')
      expect(ast.value.left.operator).toBe('==')
      expect(ast.value.right.operator).toBe('!=')
    })

    it('comparison binds tighter than equality in let value', () => {
      const ast = createParser('let r = a < b == c > d in r').parse()
      // Both < and == are at similar precedence, left-assoc
      expect(ast.value.operator).toBe('==')
    })

    it('arithmetic binds tighter than comparison in let value', () => {
      const ast = createParser('let r = a + b < c * d in r').parse()
      expect(ast.value.operator).toBe('<')
      expect(ast.value.left.operator).toBe('+')
      expect(ast.value.right.operator).toBe('*')
    })

    it('multiplication binds tighter than addition in let value', () => {
      const ast = createParser('let r = a + b * c in r').parse()
      expect(ast.value.operator).toBe('+')
      expect(ast.value.right.operator).toBe('*')
    })

    it('unary binds tightest in let value', () => {
      const ast = createParser('let r = -a + b in r').parse()
      expect(ast.value.operator).toBe('+')
      expect(ast.value.left.type).toBe('UnaryOp')
    })
  })
})
