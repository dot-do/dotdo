import { describe, it, expect } from 'vitest'
import {
  parse,
  parseExpression,
  type ImportNode,
  type ImportFromNode,
  type FunctionDefNode,
  type ClassDefNode,
  type AssignNode,
  type AugAssignNode,
  type AnnAssignNode,
  type IfNode,
  type ForNode,
  type WhileNode,
  type WithNode,
  type MatchNode,
  type TryNode,
  type RaiseNode,
  type ListCompNode,
  type DictCompNode,
  type SetCompNode,
  type GeneratorExpNode,
  type LambdaNode,
  type JoinedStrNode,
} from '../../../core/ast'

describe('Python AST Parser', () => {
  describe('Import statements', () => {
    it('parses simple import', () => {
      const ast = parse('import os')
      expect(ast.type).toBe('Module')
      expect(ast.body).toHaveLength(1)
      
      const imp = ast.body[0] as ImportNode
      expect(imp.type).toBe('Import')
      expect(imp.names).toHaveLength(1)
      expect(imp.names[0].name).toBe('os')
    })

    it('parses multiple imports', () => {
      const ast = parse('import os, sys, json')
      const imp = ast.body[0] as ImportNode
      expect(imp.names).toHaveLength(3)
      expect(imp.names.map(n => n.name)).toEqual(['os', 'sys', 'json'])
    })

    it('parses import with alias', () => {
      const ast = parse('import numpy as np')
      const imp = ast.body[0] as ImportNode
      expect(imp.names[0].name).toBe('numpy')
      expect(imp.names[0].asname).toBe('np')
    })

    it('parses from import', () => {
      const ast = parse('from os import path')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.type).toBe('ImportFrom')
      expect(imp.module).toBe('os')
      expect(imp.names[0].name).toBe('path')
      expect(imp.level).toBe(0)
    })

    it('parses from import with multiple names', () => {
      const ast = parse('from collections import OrderedDict, defaultdict, Counter')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.module).toBe('collections')
      expect(imp.names).toHaveLength(3)
    })

    it('parses from import with alias', () => {
      const ast = parse('from datetime import datetime as dt')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.names[0].name).toBe('datetime')
      expect(imp.names[0].asname).toBe('dt')
    })

    it('parses relative imports', () => {
      const ast = parse('from . import module')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.level).toBe(1)
    })

    it('parses deeply nested relative imports', () => {
      const ast = parse('from ...package.subpackage import item')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.level).toBe(3)
      expect(imp.module).toBe('package.subpackage')
    })

    it('parses star import', () => {
      const ast = parse('from module import *')
      const imp = ast.body[0] as ImportFromNode
      expect(imp.names[0].name).toBe('*')
    })
  })

  describe('Function definitions', () => {
    it('parses simple function', () => {
      const ast = parse('def foo():\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.type).toBe('FunctionDef')
      expect(fn.name).toBe('foo')
      expect(fn.args.args).toHaveLength(0)
    })

    it('parses function with positional arguments', () => {
      const ast = parse('def foo(a, b, c):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.args).toHaveLength(3)
      expect(fn.args.args.map(a => a.arg)).toEqual(['a', 'b', 'c'])
    })

    it('parses function with default arguments', () => {
      const ast = parse('def foo(a, b=1, c="default"):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.args).toHaveLength(3)
      expect(fn.args.defaults).toHaveLength(2)
    })

    it('parses function with *args', () => {
      const ast = parse('def foo(*args):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.vararg).toBeDefined()
      expect(fn.args.vararg!.arg).toBe('args')
    })

    it('parses function with **kwargs', () => {
      const ast = parse('def foo(**kwargs):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.kwarg).toBeDefined()
      expect(fn.args.kwarg!.arg).toBe('kwargs')
    })

    it('parses function with keyword-only arguments', () => {
      const ast = parse('def foo(*, x, y=10):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.kwonlyargs).toHaveLength(2)
    })

    it('parses function with mixed arguments', () => {
      const ast = parse('def foo(a, b=1, *args, c, d=2, **kwargs):\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.args).toHaveLength(2)
      expect(fn.args.vararg).toBeDefined()
      expect(fn.args.kwonlyargs).toHaveLength(2)
      expect(fn.args.kwarg).toBeDefined()
    })

    it('parses async function', () => {
      const ast = parse('async def fetch():\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.type).toBe('AsyncFunctionDef')
      expect(fn.name).toBe('fetch')
    })

    it('parses function with decorator', () => {
      const ast = parse('@decorator\ndef foo():\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.decorator_list).toHaveLength(1)
    })

    it('parses function with multiple decorators', () => {
      const ast = parse('@decorator1\n@decorator2\n@decorator3\ndef foo():\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.decorator_list).toHaveLength(3)
    })

    it('parses function with decorator with arguments', () => {
      const ast = parse('@decorator(arg1, arg2=value)\ndef foo():\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.decorator_list).toHaveLength(1)
      expect(fn.decorator_list[0].type).toBe('Call')
    })

    it('parses function with return type annotation', () => {
      const ast = parse('def foo() -> int:\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.returns).toBeDefined()
    })

    it('parses function with argument type annotations', () => {
      const ast = parse('def foo(x: int, y: str) -> bool:\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.args.args[0].annotation).toBeDefined()
      expect(fn.args.args[1].annotation).toBeDefined()
    })
  })

  describe('Class definitions', () => {
    it('parses simple class', () => {
      const ast = parse('class Foo:\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.type).toBe('ClassDef')
      expect(cls.name).toBe('Foo')
      expect(cls.bases).toHaveLength(0)
    })

    it('parses class with single inheritance', () => {
      const ast = parse('class Foo(Bar):\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.bases).toHaveLength(1)
    })

    it('parses class with multiple inheritance', () => {
      const ast = parse('class Foo(Bar, Baz, Qux):\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.bases).toHaveLength(3)
    })

    it('parses class with keyword arguments', () => {
      const ast = parse('class Foo(metaclass=ABCMeta):\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.keywords).toHaveLength(1)
    })

    it('parses class with decorator', () => {
      const ast = parse('@dataclass\nclass Foo:\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.decorator_list).toHaveLength(1)
    })

    it('parses class with multiple decorators', () => {
      const ast = parse('@decorator1\n@decorator2\nclass Foo:\n    pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.decorator_list).toHaveLength(2)
    })

    it('parses class with methods', () => {
      const ast = parse('class Foo:\n    def __init__(self):\n        pass\n    def method(self):\n        pass')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.body).toHaveLength(2)
    })

    it('parses class with class attributes', () => {
      const ast = parse('class Foo:\n    x = 10\n    y: int = 20')
      const cls = ast.body[0] as ClassDefNode
      expect(cls.body).toHaveLength(2)
    })
  })

  describe('Variable assignments', () => {
    it('parses simple assignment', () => {
      const ast = parse('x = 10')
      const assign = ast.body[0] as AssignNode
      expect(assign.type).toBe('Assign')
      expect(assign.targets).toHaveLength(1)
    })

    it('parses multiple targets assignment', () => {
      const ast = parse('x = y = z = 10')
      const assign = ast.body[0] as AssignNode
      expect(assign.targets).toHaveLength(3)
    })

    it('parses tuple unpacking', () => {
      const ast = parse('a, b, c = values')
      const assign = ast.body[0] as AssignNode
      expect(assign.targets[0].type).toBe('Tuple')
    })

    it('parses nested tuple unpacking', () => {
      const ast = parse('(a, (b, c)), d = nested')
      const assign = ast.body[0] as AssignNode
      expect(assign.targets[0].type).toBe('Tuple')
    })

    it('parses starred assignment', () => {
      const ast = parse('first, *rest, last = items')
      const assign = ast.body[0] as AssignNode
      expect(assign.targets[0].type).toBe('Tuple')
    })

    it('parses augmented assignment (+=)', () => {
      const ast = parse('x += 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.type).toBe('AugAssign')
      expect(assign.op).toBe('Add')
    })

    it('parses augmented assignment (-=)', () => {
      const ast = parse('x -= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('Sub')
    })

    it('parses augmented assignment (*=)', () => {
      const ast = parse('x *= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('Mult')
    })

    it('parses augmented assignment (/=)', () => {
      const ast = parse('x /= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('Div')
    })

    it('parses augmented assignment (//=)', () => {
      const ast = parse('x //= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('FloorDiv')
    })

    it('parses augmented assignment (%=)', () => {
      const ast = parse('x %= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('Mod')
    })

    it('parses augmented assignment (**=)', () => {
      const ast = parse('x **= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('Pow')
    })

    it('parses augmented assignment (&=)', () => {
      const ast = parse('x &= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('BitAnd')
    })

    it('parses augmented assignment (|=)', () => {
      const ast = parse('x |= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('BitOr')
    })

    it('parses augmented assignment (^=)', () => {
      const ast = parse('x ^= 5')
      const assign = ast.body[0] as AugAssignNode
      expect(assign.op).toBe('BitXor')
    })

    it('parses annotated assignment', () => {
      const ast = parse('x: int = 10')
      const assign = ast.body[0] as AnnAssignNode
      expect(assign.type).toBe('AnnAssign')
      expect(assign.annotation).toBeDefined()
      expect(assign.value).toBeDefined()
    })

    it('parses annotated assignment without value', () => {
      const ast = parse('x: int')
      const assign = ast.body[0] as AnnAssignNode
      expect(assign.type).toBe('AnnAssign')
      expect(assign.value).toBeUndefined()
    })

    it('parses complex type annotation', () => {
      const ast = parse('x: Dict[str, List[int]] = {}')
      const assign = ast.body[0] as AnnAssignNode
      expect(assign.annotation).toBeDefined()
    })

    it('parses walrus operator', () => {
      const ast = parseExpression('(x := 10)')
      expect(ast.type).toBe('NamedExpr')
    })
  })

  describe('Control flow - if/elif/else', () => {
    it('parses simple if', () => {
      const ast = parse('if x:\n    pass')
      const ifStmt = ast.body[0] as IfNode
      expect(ifStmt.type).toBe('If')
      expect(ifStmt.body).toHaveLength(1)
      expect(ifStmt.orelse).toHaveLength(0)
    })

    it('parses if-else', () => {
      const ast = parse('if x:\n    pass\nelse:\n    pass')
      const ifStmt = ast.body[0] as IfNode
      expect(ifStmt.orelse).toHaveLength(1)
    })

    it('parses if-elif', () => {
      const ast = parse('if x:\n    pass\nelif y:\n    pass')
      const ifStmt = ast.body[0] as IfNode
      expect(ifStmt.orelse).toHaveLength(1)
      expect(ifStmt.orelse[0].type).toBe('If')
    })

    it('parses if-elif-else', () => {
      const ast = parse('if x:\n    pass\nelif y:\n    pass\nelse:\n    pass')
      const ifStmt = ast.body[0] as IfNode
      const elifStmt = ifStmt.orelse[0] as IfNode
      expect(elifStmt.orelse).toHaveLength(1)
    })

    it('parses multiple elif', () => {
      const ast = parse('if a:\n    pass\nelif b:\n    pass\nelif c:\n    pass\nelse:\n    pass')
      const ifStmt = ast.body[0] as IfNode
      expect(ifStmt.type).toBe('If')
    })

    it('parses conditional expression (ternary)', () => {
      const ast = parseExpression('x if condition else y')
      expect(ast.type).toBe('IfExp')
    })
  })

  describe('Control flow - for loop', () => {
    it('parses simple for loop', () => {
      const ast = parse('for i in range(10):\n    pass')
      const forStmt = ast.body[0] as ForNode
      expect(forStmt.type).toBe('For')
    })

    it('parses for loop with tuple unpacking', () => {
      const ast = parse('for k, v in items.items():\n    pass')
      const forStmt = ast.body[0] as ForNode
      expect(forStmt.target.type).toBe('Tuple')
    })

    it('parses for-else', () => {
      const ast = parse('for i in items:\n    pass\nelse:\n    pass')
      const forStmt = ast.body[0] as ForNode
      expect(forStmt.orelse).toHaveLength(1)
    })

    it('parses async for loop', () => {
      const ast = parse('async def foo():\n    async for item in stream:\n        pass')
      const fn = ast.body[0] as FunctionDefNode
      const asyncFor = fn.body[0] as ForNode
      expect(asyncFor.type).toBe('AsyncFor')
    })
  })

  describe('Control flow - while loop', () => {
    it('parses simple while loop', () => {
      const ast = parse('while True:\n    pass')
      const whileStmt = ast.body[0] as WhileNode
      expect(whileStmt.type).toBe('While')
    })

    it('parses while-else', () => {
      const ast = parse('while condition:\n    pass\nelse:\n    pass')
      const whileStmt = ast.body[0] as WhileNode
      expect(whileStmt.orelse).toHaveLength(1)
    })
  })

  describe('Control flow - with statement', () => {
    it('parses simple with', () => {
      const ast = parse('with open("file") as f:\n    pass')
      const withStmt = ast.body[0] as WithNode
      expect(withStmt.type).toBe('With')
      expect(withStmt.items).toHaveLength(1)
    })

    it('parses with without as clause', () => {
      const ast = parse('with lock:\n    pass')
      const withStmt = ast.body[0] as WithNode
      expect(withStmt.items[0].optional_vars).toBeUndefined()
    })

    it('parses multiple context managers', () => {
      const ast = parse('with open("a") as a, open("b") as b:\n    pass')
      const withStmt = ast.body[0] as WithNode
      expect(withStmt.items).toHaveLength(2)
    })

    it('parses async with', () => {
      const ast = parse('async def foo():\n    async with session:\n        pass')
      const fn = ast.body[0] as FunctionDefNode
      const asyncWith = fn.body[0] as WithNode
      expect(asyncWith.type).toBe('AsyncWith')
    })
  })

  describe('Control flow - match/case (Python 3.10+)', () => {
    it('parses simple match', () => {
      const ast = parse('match x:\n    case 1:\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.type).toBe('Match')
      expect(matchStmt.cases).toHaveLength(1)
    })

    it('parses match with multiple cases', () => {
      const ast = parse('match x:\n    case 1:\n        pass\n    case 2:\n        pass\n    case _:\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases).toHaveLength(3)
    })

    it('parses match with capture pattern', () => {
      const ast = parse('match point:\n    case (x, y):\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases[0].pattern.type).toBe('MatchSequence')
    })

    it('parses match with class pattern', () => {
      const ast = parse('match shape:\n    case Circle(radius=r):\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases[0].pattern.type).toBe('MatchClass')
    })

    it('parses match with guard', () => {
      const ast = parse('match x:\n    case n if n > 0:\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases[0].guard).toBeDefined()
    })

    it('parses match with or pattern', () => {
      const ast = parse('match x:\n    case 1 | 2 | 3:\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases[0].pattern.type).toBe('MatchOr')
    })

    it('parses match with mapping pattern', () => {
      const ast = parse('match d:\n    case {"key": value}:\n        pass')
      const matchStmt = ast.body[0] as MatchNode
      expect(matchStmt.cases[0].pattern.type).toBe('MatchMapping')
    })
  })

  describe('Exception handling', () => {
    it('parses simple try-except', () => {
      const ast = parse('try:\n    pass\nexcept:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.type).toBe('Try')
      expect(tryStmt.handlers).toHaveLength(1)
    })

    it('parses try-except with exception type', () => {
      const ast = parse('try:\n    pass\nexcept ValueError:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers[0].type_).toBeDefined()
    })

    it('parses try-except with exception binding', () => {
      const ast = parse('try:\n    pass\nexcept ValueError as e:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers[0].name).toBe('e')
    })

    it('parses try-except with multiple handlers', () => {
      const ast = parse('try:\n    pass\nexcept ValueError:\n    pass\nexcept TypeError:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers).toHaveLength(2)
    })

    it('parses try-except with tuple of exceptions', () => {
      const ast = parse('try:\n    pass\nexcept (ValueError, TypeError):\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers[0].type_!.type).toBe('Tuple')
    })

    it('parses try-except-else', () => {
      const ast = parse('try:\n    pass\nexcept:\n    pass\nelse:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.orelse).toHaveLength(1)
    })

    it('parses try-finally', () => {
      const ast = parse('try:\n    pass\nfinally:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.finalbody).toHaveLength(1)
    })

    it('parses try-except-finally', () => {
      const ast = parse('try:\n    pass\nexcept:\n    pass\nfinally:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers).toHaveLength(1)
      expect(tryStmt.finalbody).toHaveLength(1)
    })

    it('parses try-except-else-finally', () => {
      const ast = parse('try:\n    pass\nexcept:\n    pass\nelse:\n    pass\nfinally:\n    pass')
      const tryStmt = ast.body[0] as TryNode
      expect(tryStmt.handlers).toHaveLength(1)
      expect(tryStmt.orelse).toHaveLength(1)
      expect(tryStmt.finalbody).toHaveLength(1)
    })

    it('parses simple raise', () => {
      const ast = parse('raise ValueError')
      const raiseStmt = ast.body[0] as RaiseNode
      expect(raiseStmt.type).toBe('Raise')
      expect(raiseStmt.exc).toBeDefined()
    })

    it('parses raise with message', () => {
      const ast = parse('raise ValueError("error message")')
      const raiseStmt = ast.body[0] as RaiseNode
      expect(raiseStmt.exc!.type).toBe('Call')
    })

    it('parses raise with cause', () => {
      const ast = parse('raise NewError from original')
      const raiseStmt = ast.body[0] as RaiseNode
      expect(raiseStmt.cause).toBeDefined()
    })

    it('parses bare raise (re-raise)', () => {
      const ast = parse('raise')
      const raiseStmt = ast.body[0] as RaiseNode
      expect(raiseStmt.exc).toBeUndefined()
    })
  })

  describe('Comprehensions', () => {
    it('parses list comprehension', () => {
      const ast = parseExpression('[x for x in items]')
      const comp = ast as ListCompNode
      expect(comp.type).toBe('ListComp')
      expect(comp.generators).toHaveLength(1)
    })

    it('parses list comprehension with condition', () => {
      const ast = parseExpression('[x for x in items if x > 0]')
      const comp = ast as ListCompNode
      expect(comp.generators[0].ifs).toHaveLength(1)
    })

    it('parses list comprehension with multiple conditions', () => {
      const ast = parseExpression('[x for x in items if x > 0 if x < 10]')
      const comp = ast as ListCompNode
      expect(comp.generators[0].ifs).toHaveLength(2)
    })

    it('parses nested list comprehension', () => {
      const ast = parseExpression('[x for row in matrix for x in row]')
      const comp = ast as ListCompNode
      expect(comp.generators).toHaveLength(2)
    })

    it('parses list comprehension with expression', () => {
      const ast = parseExpression('[x * 2 for x in items]')
      const comp = ast as ListCompNode
      expect(comp.elt.type).toBe('BinOp')
    })

    it('parses dict comprehension', () => {
      const ast = parseExpression('{k: v for k, v in items.items()}')
      const comp = ast as DictCompNode
      expect(comp.type).toBe('DictComp')
    })

    it('parses dict comprehension with condition', () => {
      const ast = parseExpression('{k: v for k, v in items.items() if v > 0}')
      const comp = ast as DictCompNode
      expect(comp.generators[0].ifs).toHaveLength(1)
    })

    it('parses set comprehension', () => {
      const ast = parseExpression('{x for x in items}')
      const comp = ast as SetCompNode
      expect(comp.type).toBe('SetComp')
    })

    it('parses generator expression', () => {
      const ast = parseExpression('(x for x in items)')
      const comp = ast as GeneratorExpNode
      expect(comp.type).toBe('GeneratorExp')
    })

    it('parses async comprehension', () => {
      const ast = parse('async def foo():\n    result = [x async for x in stream]')
      const fn = ast.body[0] as FunctionDefNode
      const assign = fn.body[0] as AssignNode
      const comp = assign.value as ListCompNode
      expect(comp.generators[0].is_async).toBe(1)
    })
  })

  describe('Lambda expressions', () => {
    it('parses simple lambda', () => {
      const ast = parseExpression('lambda: 42')
      const lambda = ast as LambdaNode
      expect(lambda.type).toBe('Lambda')
      expect(lambda.args.args).toHaveLength(0)
    })

    it('parses lambda with single argument', () => {
      const ast = parseExpression('lambda x: x * 2')
      const lambda = ast as LambdaNode
      expect(lambda.args.args).toHaveLength(1)
    })

    it('parses lambda with multiple arguments', () => {
      const ast = parseExpression('lambda x, y, z: x + y + z')
      const lambda = ast as LambdaNode
      expect(lambda.args.args).toHaveLength(3)
    })

    it('parses lambda with default arguments', () => {
      const ast = parseExpression('lambda x, y=10: x + y')
      const lambda = ast as LambdaNode
      expect(lambda.args.defaults).toHaveLength(1)
    })

    it('parses lambda with *args', () => {
      const ast = parseExpression('lambda *args: sum(args)')
      const lambda = ast as LambdaNode
      expect(lambda.args.vararg).toBeDefined()
    })

    it('parses lambda with **kwargs', () => {
      const ast = parseExpression('lambda **kwargs: kwargs')
      const lambda = ast as LambdaNode
      expect(lambda.args.kwarg).toBeDefined()
    })
  })

  describe('F-strings', () => {
    it('parses simple f-string', () => {
      const ast = parseExpression('f"hello"')
      const fstring = ast as JoinedStrNode
      expect(fstring.type).toBe('JoinedStr')
    })

    it('parses f-string with expression', () => {
      const ast = parseExpression('f"hello {name}"')
      const fstring = ast as JoinedStrNode
      expect(fstring.values.length).toBeGreaterThan(1)
    })

    it('parses f-string with multiple expressions', () => {
      const ast = parseExpression('f"{greeting} {name}!"')
      const fstring = ast as JoinedStrNode
      expect(fstring.values.some(v => v.type === 'FormattedValue')).toBe(true)
    })

    it('parses f-string with format spec', () => {
      const ast = parseExpression('f"{value:.2f}"')
      const fstring = ast as JoinedStrNode
      const formatted = fstring.values.find(v => v.type === 'FormattedValue')
      expect(formatted).toBeDefined()
    })

    it('parses f-string with conversion', () => {
      const ast = parseExpression('f"{value!r}"')
      const fstring = ast as JoinedStrNode
      const formatted = fstring.values.find(v => v.type === 'FormattedValue')
      expect(formatted).toBeDefined()
    })

    it('parses f-string with expression and format', () => {
      const ast = parseExpression('f"{value * 100:.1f}%"')
      const fstring = ast as JoinedStrNode
      expect(fstring.values.some(v => v.type === 'FormattedValue')).toBe(true)
    })

    it('parses nested f-string', () => {
      const ast = parseExpression('f"outer {f\'inner {x}\'}"')
      const fstring = ast as JoinedStrNode
      expect(fstring.type).toBe('JoinedStr')
    })

    it('parses f-string with braces escaped', () => {
      const ast = parseExpression('f"{{literal braces}}"')
      const fstring = ast as JoinedStrNode
      expect(fstring.type).toBe('JoinedStr')
    })

    it('parses multiline f-string', () => {
      const ast = parseExpression('f"""multi\nline {value}\nstring"""')
      const fstring = ast as JoinedStrNode
      expect(fstring.type).toBe('JoinedStr')
    })
  })

  describe('Type annotations', () => {
    it('parses simple type annotation', () => {
      const ast = parse('x: int')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation).toBeDefined()
    })

    it('parses generic type annotation', () => {
      const ast = parse('x: List[int]')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation!.type).toBe('Subscript')
    })

    it('parses nested generic type annotation', () => {
      const ast = parse('x: Dict[str, List[int]]')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation).toBeDefined()
    })

    it('parses union type annotation (|)', () => {
      const ast = parse('x: int | str')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation!.type).toBe('BinOp')
    })

    it('parses Optional type annotation', () => {
      const ast = parse('x: Optional[int]')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation).toBeDefined()
    })

    it('parses Callable type annotation', () => {
      const ast = parse('x: Callable[[int, str], bool]')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation).toBeDefined()
    })

    it('parses tuple type annotation', () => {
      const ast = parse('x: Tuple[int, str, float]')
      const ann = ast.body[0] as AnnAssignNode
      expect(ann.annotation).toBeDefined()
    })

    it('parses function with complex return type', () => {
      const ast = parse('def foo() -> Dict[str, List[int]]:\n    pass')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.returns).toBeDefined()
    })

    it('parses type alias (Python 3.12+)', () => {
      const ast = parse('type Point = tuple[float, float]')
      expect(ast.body[0].type).toBe('TypeAlias')
    })

    it('parses generic function (Python 3.12+)', () => {
      const ast = parse('def foo[T](x: T) -> T:\n    return x')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn).toBeDefined()
    })

    it('parses generic class (Python 3.12+)', () => {
      const ast = parse('class Box[T]:\n    value: T')
      const cls = ast.body[0] as ClassDefNode
      expect(cls).toBeDefined()
    })
  })

  describe('Additional statements', () => {
    it('parses pass statement', () => {
      const ast = parse('pass')
      expect(ast.body[0].type).toBe('Pass')
    })

    it('parses break statement', () => {
      const ast = parse('for x in y:\n    break')
      const forStmt = ast.body[0] as ForNode
      expect(forStmt.body[0].type).toBe('Break')
    })

    it('parses continue statement', () => {
      const ast = parse('for x in y:\n    continue')
      const forStmt = ast.body[0] as ForNode
      expect(forStmt.body[0].type).toBe('Continue')
    })

    it('parses return statement', () => {
      const ast = parse('def foo():\n    return 42')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.body[0].type).toBe('Return')
    })

    it('parses yield statement', () => {
      const ast = parse('def foo():\n    yield 42')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.body[0].type).toBe('Expr')
    })

    it('parses yield from statement', () => {
      const ast = parse('def foo():\n    yield from other()')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.body[0].type).toBe('Expr')
    })

    it('parses await expression', () => {
      const ast = parse('async def foo():\n    await bar()')
      const fn = ast.body[0] as FunctionDefNode
      expect(fn.body[0].type).toBe('Expr')
    })

    it('parses global statement', () => {
      const ast = parse('global x, y')
      expect(ast.body[0].type).toBe('Global')
    })

    it('parses nonlocal statement', () => {
      const ast = parse('def outer():\n    def inner():\n        nonlocal x')
      expect(ast.body[0].type).toBe('FunctionDef')
    })

    it('parses assert statement', () => {
      const ast = parse('assert x > 0')
      expect(ast.body[0].type).toBe('Assert')
    })

    it('parses assert with message', () => {
      const ast = parse('assert x > 0, "x must be positive"')
      expect(ast.body[0].type).toBe('Assert')
    })

    it('parses del statement', () => {
      const ast = parse('del x')
      expect(ast.body[0].type).toBe('Delete')
    })
  })

  describe('Expressions', () => {
    it('parses binary operations', () => {
      const ast = parseExpression('a + b * c')
      expect(ast.type).toBe('BinOp')
    })

    it('parses comparison operations', () => {
      const ast = parseExpression('a < b <= c')
      expect(ast.type).toBe('Compare')
    })

    it('parses boolean operations', () => {
      const ast = parseExpression('a and b or c')
      expect(ast.type).toBe('BoolOp')
    })

    it('parses unary operations', () => {
      const ast = parseExpression('-x')
      expect(ast.type).toBe('UnaryOp')
    })

    it('parses attribute access', () => {
      const ast = parseExpression('obj.attr')
      expect(ast.type).toBe('Attribute')
    })

    it('parses subscript access', () => {
      const ast = parseExpression('obj[key]')
      expect(ast.type).toBe('Subscript')
    })

    it('parses slice', () => {
      const ast = parseExpression('lst[1:10:2]')
      expect(ast.type).toBe('Subscript')
    })

    it('parses function call', () => {
      const ast = parseExpression('foo(a, b, c=1)')
      expect(ast.type).toBe('Call')
    })

    it('parses starred expression in call', () => {
      const ast = parseExpression('foo(*args, **kwargs)')
      expect(ast.type).toBe('Call')
    })

    it('parses list literal', () => {
      const ast = parseExpression('[1, 2, 3]')
      expect(ast.type).toBe('List')
    })

    it('parses dict literal', () => {
      const ast = parseExpression('{"a": 1, "b": 2}')
      expect(ast.type).toBe('Dict')
    })

    it('parses set literal', () => {
      const ast = parseExpression('{1, 2, 3}')
      expect(ast.type).toBe('Set')
    })

    it('parses tuple literal', () => {
      const ast = parseExpression('(1, 2, 3)')
      expect(ast.type).toBe('Tuple')
    })
  })
})
