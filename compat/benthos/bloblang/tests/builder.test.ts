/**
 * RED Phase Tests: Typesafe Bloblang DSL Builder
 * Issue: dotdo-nz80p
 *
 * These tests define the expected behavior for a typesafe Bloblang DSL builder
 * that replaces string-based Bloblang expressions with a fluent TypeScript API.
 *
 * Goal: Replace string-based Bloblang:
 *   { mapping: 'root.user = this.name.uppercase()' }
 *
 * With a typesafe builder:
 *   import { $ } from '../builder'
 *   const expr = $.root.user.set($.this.name.uppercase())
 *   expr.toString() // -> 'root.user = this.name.uppercase()'
 *
 * These tests should FAIL until the implementation is complete.
 */

import { describe, it, expect } from 'vitest'
import { $, BloblangExpr } from '../builder'

describe('Bloblang DSL Builder', () => {
  describe('Basic References', () => {
    it('creates root reference', () => {
      const expr = $.root
      expect(expr.toString()).toBe('root')
    })

    it('creates this reference', () => {
      const expr = $.this
      expect(expr.toString()).toBe('this')
    })

    it('creates meta reference without key', () => {
      const expr = $.meta()
      expect(expr.toString()).toBe('meta()')
    })

    it('creates meta reference with key', () => {
      const expr = $.meta('kafka_key')
      expect(expr.toString()).toBe('meta("kafka_key")')
    })

    it('creates deleted() special value', () => {
      const expr = $.deleted()
      expect(expr.toString()).toBe('deleted()')
    })

    it('creates nothing() special value', () => {
      const expr = $.nothing()
      expect(expr.toString()).toBe('nothing()')
    })
  })

  describe('Field Access - Dot Notation', () => {
    it('accesses single field on root', () => {
      const expr = $.root.user
      expect(expr.toString()).toBe('root.user')
    })

    it('accesses nested fields on root', () => {
      const expr = $.root.user.name
      expect(expr.toString()).toBe('root.user.name')
    })

    it('accesses deeply nested fields', () => {
      const expr = $.root.data.user.profile.address.city
      expect(expr.toString()).toBe('root.data.user.profile.address.city')
    })

    it('accesses fields on this', () => {
      const expr = $.this.name
      expect(expr.toString()).toBe('this.name')
    })

    it('accesses nested fields on this', () => {
      const expr = $.this.user.email
      expect(expr.toString()).toBe('this.user.email')
    })
  })

  describe('Field Access - Bracket Notation', () => {
    it('accesses field with dash using bracket notation', () => {
      const expr = $.root['field-with-dash']
      expect(expr.toString()).toBe('root["field-with-dash"]')
    })

    it('accesses field with space using bracket notation', () => {
      const expr = $.root['field with space']
      expect(expr.toString()).toBe('root["field with space"]')
    })

    it('accesses field with special characters', () => {
      const expr = $.root['field.with.dots']
      expect(expr.toString()).toBe('root["field.with.dots"]')
    })

    it('accesses numeric index on array', () => {
      const expr = $.root.items[0]
      expect(expr.toString()).toBe('root.items[0]')
    })

    it('accesses negative index on array', () => {
      const expr = $.root.items[-1]
      expect(expr.toString()).toBe('root.items[-1]')
    })

    it('mixes dot and bracket notation', () => {
      const expr = $.root.users[0].name
      expect(expr.toString()).toBe('root.users[0].name')
    })

    it('accesses dynamic field using expression', () => {
      const fieldName = $.this.field_name
      const expr = $.root.get(fieldName)
      expect(expr.toString()).toBe('root.(this.field_name)')
    })
  })

  describe('String Methods', () => {
    it('calls uppercase()', () => {
      const expr = $.this.name.uppercase()
      expect(expr.toString()).toBe('this.name.uppercase()')
    })

    it('calls lowercase()', () => {
      const expr = $.this.name.lowercase()
      expect(expr.toString()).toBe('this.name.lowercase()')
    })

    it('calls length()', () => {
      const expr = $.this.name.length()
      expect(expr.toString()).toBe('this.name.length()')
    })

    it('calls trim()', () => {
      const expr = $.this.name.trim()
      expect(expr.toString()).toBe('this.name.trim()')
    })

    it('calls contains() with string argument', () => {
      const expr = $.this.email.contains('@')
      expect(expr.toString()).toBe('this.email.contains("@")')
    })

    it('calls has_prefix()', () => {
      const expr = $.this.name.has_prefix('Mr.')
      expect(expr.toString()).toBe('this.name.has_prefix("Mr.")')
    })

    it('calls has_suffix()', () => {
      const expr = $.this.email.has_suffix('.com')
      expect(expr.toString()).toBe('this.email.has_suffix(".com")')
    })

    it('calls replace() with two arguments', () => {
      const expr = $.this.text.replace('old', 'new')
      expect(expr.toString()).toBe('this.text.replace("old", "new")')
    })

    it('calls replace_all()', () => {
      const expr = $.this.text.replace_all(' ', '_')
      expect(expr.toString()).toBe('this.text.replace_all(" ", "_")')
    })

    it('calls split()', () => {
      const expr = $.this.csv.split(',')
      expect(expr.toString()).toBe('this.csv.split(",")')
    })

    it('calls slice() with start only', () => {
      const expr = $.this.name.slice(5)
      expect(expr.toString()).toBe('this.name.slice(5)')
    })

    it('calls slice() with start and end', () => {
      const expr = $.this.name.slice(0, 5)
      expect(expr.toString()).toBe('this.name.slice(0, 5)')
    })

    it('chains multiple string methods', () => {
      const expr = $.this.name.trim().uppercase()
      expect(expr.toString()).toBe('this.name.trim().uppercase()')
    })
  })

  describe('Arithmetic Operations', () => {
    it('adds a number with .add()', () => {
      const expr = $.this.count.add(5)
      expect(expr.toString()).toBe('this.count + 5')
    })

    it('subtracts a number with .sub()', () => {
      const expr = $.this.count.sub(2)
      expect(expr.toString()).toBe('this.count - 2')
    })

    it('multiplies a number with .mul()', () => {
      const expr = $.this.price.mul(3)
      expect(expr.toString()).toBe('this.price * 3')
    })

    it('divides a number with .div()', () => {
      const expr = $.this.total.div(2)
      expect(expr.toString()).toBe('this.total / 2')
    })

    it('computes modulo with .mod()', () => {
      const expr = $.this.index.mod(10)
      expect(expr.toString()).toBe('this.index % 10')
    })

    it('chains arithmetic operations', () => {
      const expr = $.this.value.add(10).mul(2)
      expect(expr.toString()).toBe('(this.value + 10) * 2')
    })

    it('adds an expression', () => {
      const expr = $.this.x.add($.this.y)
      expect(expr.toString()).toBe('this.x + this.y')
    })

    it('negates a value with .negate()', () => {
      const expr = $.this.value.negate()
      expect(expr.toString()).toBe('-this.value')
    })

    it('computes absolute value with .abs()', () => {
      const expr = $.this.diff.abs()
      expect(expr.toString()).toBe('this.diff.abs()')
    })

    it('rounds with .round()', () => {
      const expr = $.this.price.round()
      expect(expr.toString()).toBe('this.price.round()')
    })

    it('floors with .floor()', () => {
      const expr = $.this.value.floor()
      expect(expr.toString()).toBe('this.value.floor()')
    })

    it('ceils with .ceil()', () => {
      const expr = $.this.value.ceil()
      expect(expr.toString()).toBe('this.value.ceil()')
    })
  })

  describe('Comparison Operations', () => {
    it('checks equality with .eq()', () => {
      const expr = $.this.status.eq('active')
      expect(expr.toString()).toBe('this.status == "active"')
    })

    it('checks inequality with .neq()', () => {
      const expr = $.this.status.neq('deleted')
      expect(expr.toString()).toBe('this.status != "deleted"')
    })

    it('checks greater than with .gt()', () => {
      const expr = $.this.age.gt(18)
      expect(expr.toString()).toBe('this.age > 18')
    })

    it('checks greater than or equal with .gte()', () => {
      const expr = $.this.age.gte(21)
      expect(expr.toString()).toBe('this.age >= 21')
    })

    it('checks less than with .lt()', () => {
      const expr = $.this.count.lt(100)
      expect(expr.toString()).toBe('this.count < 100')
    })

    it('checks less than or equal with .lte()', () => {
      const expr = $.this.count.lte(50)
      expect(expr.toString()).toBe('this.count <= 50')
    })

    it('compares with another expression', () => {
      const expr = $.this.start.lt($.this.end)
      expect(expr.toString()).toBe('this.start < this.end')
    })

    it('checks equality with number', () => {
      const expr = $.this.count.eq(0)
      expect(expr.toString()).toBe('this.count == 0')
    })

    it('checks equality with boolean', () => {
      const expr = $.this.active.eq(true)
      expect(expr.toString()).toBe('this.active == true')
    })

    it('checks equality with null', () => {
      const expr = $.this.value.eq(null)
      expect(expr.toString()).toBe('this.value == null')
    })
  })

  describe('Logical Operations', () => {
    it('combines conditions with .and()', () => {
      const expr = $.this.age.gt(18).and($.this.active.eq(true))
      expect(expr.toString()).toBe('(this.age > 18) && (this.active == true)')
    })

    it('combines conditions with .or()', () => {
      const expr = $.this.role.eq('admin').or($.this.role.eq('superuser'))
      expect(expr.toString()).toBe('(this.role == "admin") || (this.role == "superuser")')
    })

    it('negates condition with .not()', () => {
      const expr = $.this.deleted.not()
      expect(expr.toString()).toBe('!this.deleted')
    })

    it('chains logical operations', () => {
      const expr = $.this.a.and($.this.b).or($.this.c)
      expect(expr.toString()).toBe('((this.a) && (this.b)) || (this.c)')
    })

    it('applies not to comparison', () => {
      const expr = $.this.status.eq('error').not()
      expect(expr.toString()).toBe('!(this.status == "error")')
    })

    it('creates complex boolean expression', () => {
      const isAdmin = $.this.role.eq('admin')
      const isActive = $.this.active.eq(true)
      const canAccess = isAdmin.and(isActive)
      expect(canAccess.toString()).toBe('(this.role == "admin") && (this.active == true)')
    })
  })

  describe('Array Methods', () => {
    it('maps over array with lambda', () => {
      const expr = $.this.items.map(x => x.value)
      expect(expr.toString()).toBe('this.items.map_each(item -> item.value)')
    })

    it('filters array with lambda', () => {
      const expr = $.this.items.filter(x => x.active)
      expect(expr.toString()).toBe('this.items.filter(item -> item.active)')
    })

    it('flattens nested array', () => {
      const expr = $.this.nested.flatten()
      expect(expr.toString()).toBe('this.nested.flatten()')
    })

    it('gets first element', () => {
      const expr = $.this.items.first()
      expect(expr.toString()).toBe('this.items.first()')
    })

    it('gets last element', () => {
      const expr = $.this.items.last()
      expect(expr.toString()).toBe('this.items.last()')
    })

    it('sorts array', () => {
      const expr = $.this.numbers.sort()
      expect(expr.toString()).toBe('this.numbers.sort()')
    })

    it('sorts array by key with lambda', () => {
      const expr = $.this.items.sort_by(x => x.timestamp)
      expect(expr.toString()).toBe('this.items.sort_by(item -> item.timestamp)')
    })

    it('reverses array', () => {
      const expr = $.this.items.reverse()
      expect(expr.toString()).toBe('this.items.reverse()')
    })

    it('gets unique elements', () => {
      const expr = $.this.tags.unique()
      expect(expr.toString()).toBe('this.tags.unique()')
    })

    it('appends element to array', () => {
      const expr = $.this.items.append('new')
      expect(expr.toString()).toBe('this.items.append("new")')
    })

    it('concatenates arrays', () => {
      const expr = $.this.items.concat($.this.more_items)
      expect(expr.toString()).toBe('this.items.concat(this.more_items)')
    })

    it('checks if array contains value', () => {
      const expr = $.this.tags.contains('important')
      expect(expr.toString()).toBe('this.tags.contains("important")')
    })

    it('checks if any element matches predicate', () => {
      const expr = $.this.items.any(x => x.error)
      expect(expr.toString()).toBe('this.items.any(item -> item.error)')
    })

    it('checks if all elements match predicate', () => {
      const expr = $.this.items.all(x => x.valid)
      expect(expr.toString()).toBe('this.items.all(item -> item.valid)')
    })

    it('joins array elements', () => {
      const expr = $.this.names.join(', ')
      expect(expr.toString()).toBe('this.names.join(", ")')
    })

    it('slices array', () => {
      const expr = $.this.items.slice(0, 10)
      expect(expr.toString()).toBe('this.items.slice(0, 10)')
    })

    it('gets element at index', () => {
      const expr = $.this.items.index(5)
      expect(expr.toString()).toBe('this.items.index(5)')
    })

    it('sums numeric array', () => {
      const expr = $.this.prices.sum()
      expect(expr.toString()).toBe('this.prices.sum()')
    })

    it('chains array methods', () => {
      const expr = $.this.items.filter(x => x.active).map(x => x.name)
      expect(expr.toString()).toBe('this.items.filter(item -> item.active).map_each(item -> item.name)')
    })
  })

  describe('Object Methods', () => {
    it('gets object keys', () => {
      const expr = $.this.data.keys()
      expect(expr.toString()).toBe('this.data.keys()')
    })

    it('gets object values', () => {
      const expr = $.this.data.values()
      expect(expr.toString()).toBe('this.data.values()')
    })

    it('merges objects', () => {
      const expr = $.this.base.merge($.this.overrides)
      expect(expr.toString()).toBe('this.base.merge(this.overrides)')
    })

    it('removes keys from object', () => {
      const expr = $.this.data.without(['password', 'secret'])
      expect(expr.toString()).toBe('this.data.without(["password", "secret"])')
    })

    it('checks if key exists', () => {
      const expr = $.this.data.exists('key')
      expect(expr.toString()).toBe('this.data.exists("key")')
    })
  })

  describe('Type Conversion', () => {
    it('converts to string with .string()', () => {
      const expr = $.this.count.string()
      expect(expr.toString()).toBe('this.count.string()')
    })

    it('converts to number with .number()', () => {
      const expr = $.this.str_value.number()
      expect(expr.toString()).toBe('this.str_value.number()')
    })

    it('converts to int with .int()', () => {
      const expr = $.this.float_value.int()
      expect(expr.toString()).toBe('this.float_value.int()')
    })

    it('converts to bool with .bool()', () => {
      const expr = $.this.flag.bool()
      expect(expr.toString()).toBe('this.flag.bool()')
    })

    it('gets type with .type()', () => {
      const expr = $.this.value.type()
      expect(expr.toString()).toBe('this.value.type()')
    })
  })

  describe('Assignment - Set Operations', () => {
    it('sets root to expression', () => {
      const expr = $.root.set($.this)
      expect(expr.toString()).toBe('root = this')
    })

    it('sets field to literal string', () => {
      const expr = $.root.user.set('anonymous')
      expect(expr.toString()).toBe('root.user = "anonymous"')
    })

    it('sets field to literal number', () => {
      const expr = $.root.count.set(0)
      expect(expr.toString()).toBe('root.count = 0')
    })

    it('sets field to expression', () => {
      const expr = $.root.user.set($.this.name.uppercase())
      expect(expr.toString()).toBe('root.user = this.name.uppercase()')
    })

    it('sets nested field', () => {
      const expr = $.root.data.user.name.set($.this.full_name)
      expect(expr.toString()).toBe('root.data.user.name = this.full_name')
    })

    it('sets meta value', () => {
      const expr = $.meta('output_key').set($.this.id)
      expect(expr.toString()).toBe('meta("output_key") = this.id')
    })

    it('deletes field', () => {
      const expr = $.root.password.set($.deleted())
      expect(expr.toString()).toBe('root.password = deleted()')
    })

    it('sets field to object literal', () => {
      const expr = $.root.user.set($.object({
        name: $.this.name,
        email: $.this.email,
      }))
      expect(expr.toString()).toBe('root.user = {"name": this.name, "email": this.email}')
    })

    it('sets field to array literal', () => {
      const expr = $.root.tags.set($.array([$.literal('a'), $.literal('b')]))
      expect(expr.toString()).toBe('root.tags = ["a", "b"]')
    })
  })

  describe('If/Else Expressions', () => {
    it('creates simple if expression', () => {
      const expr = $.if($.this.active).then($.literal('yes')).else($.literal('no'))
      expect(expr.toString()).toBe('if this.active { "yes" } else { "no" }')
    })

    it('creates if without else', () => {
      const expr = $.if($.this.active).then($.this.name)
      expect(expr.toString()).toBe('if this.active { this.name }')
    })

    it('creates if with comparison condition', () => {
      const expr = $.if($.this.age.gt(18)).then($.literal('adult')).else($.literal('minor'))
      expect(expr.toString()).toBe('if this.age > 18 { "adult" } else { "minor" }')
    })

    it('creates nested if expressions', () => {
      const expr = $.if($.this.type.eq('a'))
        .then($.literal('A'))
        .else($.if($.this.type.eq('b'))
          .then($.literal('B'))
          .else($.literal('other')))
      expect(expr.toString()).toBe('if this.type == "a" { "A" } else { if this.type == "b" { "B" } else { "other" } }')
    })

    it('creates if with complex body', () => {
      const expr = $.if($.this.valid)
        .then($.this.data.uppercase())
        .else($.literal('invalid'))
      expect(expr.toString()).toBe('if this.valid { this.data.uppercase() } else { "invalid" }')
    })
  })

  describe('Literals', () => {
    it('creates string literal', () => {
      const expr = $.literal('hello')
      expect(expr.toString()).toBe('"hello"')
    })

    it('creates number literal', () => {
      const expr = $.literal(42)
      expect(expr.toString()).toBe('42')
    })

    it('creates float literal', () => {
      const expr = $.literal(3.14)
      expect(expr.toString()).toBe('3.14')
    })

    it('creates boolean true literal', () => {
      const expr = $.literal(true)
      expect(expr.toString()).toBe('true')
    })

    it('creates boolean false literal', () => {
      const expr = $.literal(false)
      expect(expr.toString()).toBe('false')
    })

    it('creates null literal', () => {
      const expr = $.literal(null)
      expect(expr.toString()).toBe('null')
    })

    it('escapes special characters in strings', () => {
      const expr = $.literal('hello "world"')
      expect(expr.toString()).toBe('"hello \\"world\\""')
    })

    it('escapes newlines in strings', () => {
      const expr = $.literal('line1\nline2')
      expect(expr.toString()).toBe('"line1\\nline2"')
    })
  })

  describe('Object and Array Literals', () => {
    it('creates empty object', () => {
      const expr = $.object({})
      expect(expr.toString()).toBe('{}')
    })

    it('creates object with literal values', () => {
      const expr = $.object({
        name: $.literal('Alice'),
        age: $.literal(30),
      })
      expect(expr.toString()).toBe('{"name": "Alice", "age": 30}')
    })

    it('creates object with expression values', () => {
      const expr = $.object({
        upper: $.this.name.uppercase(),
        lower: $.this.name.lowercase(),
      })
      expect(expr.toString()).toBe('{"upper": this.name.uppercase(), "lower": this.name.lowercase()}')
    })

    it('creates nested object', () => {
      const expr = $.object({
        user: $.object({
          name: $.this.name,
        }),
      })
      expect(expr.toString()).toBe('{"user": {"name": this.name}}')
    })

    it('creates empty array', () => {
      const expr = $.array([])
      expect(expr.toString()).toBe('[]')
    })

    it('creates array with literal values', () => {
      const expr = $.array([$.literal(1), $.literal(2), $.literal(3)])
      expect(expr.toString()).toBe('[1, 2, 3]')
    })

    it('creates array with expressions', () => {
      const expr = $.array([$.this.a, $.this.b, $.this.c])
      expect(expr.toString()).toBe('[this.a, this.b, this.c]')
    })

    it('creates nested array', () => {
      const expr = $.array([
        $.array([$.literal(1), $.literal(2)]),
        $.array([$.literal(3), $.literal(4)]),
      ])
      expect(expr.toString()).toBe('[[1, 2], [3, 4]]')
    })
  })

  describe('Pipe Expressions', () => {
    it('pipes through single function', () => {
      const expr = $.this.name.pipe($.fn('uppercase'))
      expect(expr.toString()).toBe('this.name | uppercase()')
    })

    it('pipes through function with argument', () => {
      const expr = $.this.text.pipe($.fn('replace', [$.literal(' '), $.literal('_')]))
      expect(expr.toString()).toBe('this.text | replace(" ", "_")')
    })

    it('chains pipes', () => {
      const expr = $.this.name.pipe($.fn('uppercase')).pipe($.fn('trim'))
      expect(expr.toString()).toBe('this.name | uppercase() | trim()')
    })
  })

  describe('Let Bindings', () => {
    it('creates let binding', () => {
      const expr = $.let('x', $.this.value, x => x.mul(2))
      expect(expr.toString()).toBe('let x = this.value; x * 2')
    })

    it('creates nested let bindings', () => {
      const expr = $.let('x', $.this.a, x =>
        $.let('y', $.this.b, y => x.add(y))
      )
      expect(expr.toString()).toBe('let x = this.a; let y = this.b; x + y')
    })
  })

  describe('Match Expressions', () => {
    it('creates match expression with cases', () => {
      const expr = $.match($.this.status)
        .case($.literal('active'), $.literal('running'))
        .case($.literal('paused'), $.literal('stopped'))
        .default($.literal('unknown'))
      expect(expr.toString()).toBe('match this.status { "active" => "running", "paused" => "stopped", _ => "unknown" }')
    })

    it('creates match without default', () => {
      const expr = $.match($.this.code)
        .case($.literal(200), $.literal('ok'))
        .case($.literal(404), $.literal('not found'))
      expect(expr.toString()).toBe('match this.code { 200 => "ok", 404 => "not found" }')
    })
  })

  describe('Function Calls', () => {
    it('calls global function with no args', () => {
      const expr = $.fn('uuid_v4')
      expect(expr.toString()).toBe('uuid_v4()')
    })

    it('calls global function with args', () => {
      const expr = $.fn('max', [$.this.a, $.this.b])
      expect(expr.toString()).toBe('max(this.a, this.b)')
    })

    it('calls from_json', () => {
      const expr = $.this.json_str.from_json()
      expect(expr.toString()).toBe('this.json_str.from_json()')
    })

    it('calls to_json', () => {
      const expr = $.this.data.to_json()
      expect(expr.toString()).toBe('this.data.to_json()')
    })
  })

  describe('JSON Functions', () => {
    it('parses JSON from string', () => {
      const expr = $.this.json_string.parse_json()
      expect(expr.toString()).toBe('this.json_string.parse_json()')
    })

    it('serializes to JSON string', () => {
      const expr = $.this.object.to_json()
      expect(expr.toString()).toBe('this.object.to_json()')
    })
  })

  describe('Complex Real-World Expressions', () => {
    it('transforms user data', () => {
      const expr = $.root.set($.object({
        id: $.this.user_id,
        name: $.this.full_name.uppercase(),
        email: $.this.email.lowercase(),
        active: $.this.status.eq('active'),
      }))
      expect(expr.toString()).toBe(
        'root = {"id": this.user_id, "name": this.full_name.uppercase(), "email": this.email.lowercase(), "active": this.status == "active"}'
      )
    })

    it('filters and transforms array', () => {
      const expr = $.root.users.set(
        $.this.users
          .filter(u => u.active)
          .map(u => u.name.uppercase())
      )
      expect(expr.toString()).toBe(
        'root.users = this.users.filter(item -> item.active).map_each(item -> item.name.uppercase())'
      )
    })

    it('conditional assignment based on data', () => {
      const expr = $.root.category.set(
        $.if($.this.price.gt(1000))
          .then($.literal('premium'))
          .else($.if($.this.price.gt(100))
            .then($.literal('standard'))
            .else($.literal('budget')))
      )
      expect(expr.toString()).toBe(
        'root.category = if this.price > 1000 { "premium" } else { if this.price > 100 { "standard" } else { "budget" } }'
      )
    })

    it('merges and transforms objects', () => {
      const expr = $.root.set(
        $.this.base.merge($.object({
          timestamp: $.fn('now'),
          processed: $.literal(true),
        }))
      )
      expect(expr.toString()).toBe(
        'root = this.base.merge({"timestamp": now(), "processed": true})'
      )
    })

    it('handles nested data extraction', () => {
      const expr = $.root.summary.set($.object({
        total: $.this.items.map(x => x.price).sum(),
        count: $.this.items.length(),
        first_item: $.this.items.first(),
      }))
      expect(expr.toString()).toBe(
        'root.summary = {"total": this.items.map_each(item -> item.price).sum(), "count": this.items.length(), "first_item": this.items.first()}'
      )
    })
  })

  describe('Expression Composition', () => {
    it('reuses expressions as variables', () => {
      const isActive = $.this.status.eq('active')
      const isAdmin = $.this.role.eq('admin')
      const canDelete = isActive.and(isAdmin)

      expect(canDelete.toString()).toBe('(this.status == "active") && (this.role == "admin")')
    })

    it('builds expression incrementally', () => {
      let expr: BloblangExpr = $.this.items
      expr = expr.filter(x => x.valid)
      expr = expr.map(x => x.value)
      expr = expr.sum()

      expect(expr.toString()).toBe('this.items.filter(item -> item.valid).map_each(item -> item.value).sum()')
    })
  })

  describe('Type Safety (compile-time)', () => {
    it('enforces BloblangExpr type', () => {
      const expr: BloblangExpr = $.this.name
      expect(expr.toString()).toBe('this.name')
    })

    it('allows chaining methods on BloblangExpr', () => {
      const expr: BloblangExpr = $.this.name.uppercase().length()
      expect(expr.toString()).toBe('this.name.uppercase().length()')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty field name', () => {
      const expr = $.root['']
      expect(expr.toString()).toBe('root[""]')
    })

    it('handles unicode field names', () => {
      const expr = $.root['nombre']
      expect(expr.toString()).toBe('root.nombre')
    })

    it('handles very long chains', () => {
      let expr: BloblangExpr = $.this
      for (let i = 0; i < 10; i++) {
        expr = (expr as any)[`field${i}`]
      }
      expect(expr.toString()).toBe('this.field0.field1.field2.field3.field4.field5.field6.field7.field8.field9')
    })

    it('preserves numeric zero in expressions', () => {
      const expr = $.this.count.eq(0)
      expect(expr.toString()).toBe('this.count == 0')
    })

    it('handles negative numbers in comparisons', () => {
      const expr = $.this.temp.lt(-10)
      expect(expr.toString()).toBe('this.temp < -10')
    })
  })

  describe('AST Generation', () => {
    it('generates AST from expression', () => {
      const expr = $.this.name.uppercase()
      const ast = expr.toAST()
      expect(ast).toBeDefined()
      expect(ast.type).toBe('Call')
    })

    it('generates AST for assignment', () => {
      const expr = $.root.user.set($.this.name)
      const ast = expr.toAST()
      expect(ast).toBeDefined()
      expect(ast.type).toBe('Assign')
    })

    it('roundtrips through AST', () => {
      const expr = $.this.items.filter(x => x.active).map(x => x.name)
      const ast = expr.toAST()
      const str = expr.toString()
      expect(str).toBe('this.items.filter(item -> item.active).map_each(item -> item.name)')
    })
  })
})
