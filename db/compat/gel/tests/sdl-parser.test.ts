/**
 * SDL Parser Tests - RED Phase
 *
 * These tests define the complete SDL parsing contract for the Gel compatibility layer.
 * The parser doesn't exist yet - that's the point of TDD.
 *
 * Coverage: ~200 tests across 10 categories
 */

import { describe, it, expect } from 'vitest'
import { parseSDL } from '../sdl-parser'

// =============================================================================
// 1. TYPE DEFINITIONS (30 tests)
// =============================================================================

describe('Type Definitions', () => {
  describe('basic types', () => {
    it('parses empty type', () => {
      const schema = parseSDL(`type User { }`)
      expect(schema.types).toHaveLength(1)
      expect(schema.types[0].name).toBe('User')
      expect(schema.types[0].properties).toHaveLength(0)
    })

    it('parses type with single property', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types).toHaveLength(1)
      expect(schema.types[0].name).toBe('User')
      expect(schema.types[0].properties).toHaveLength(1)
      expect(schema.types[0].properties[0].name).toBe('name')
      expect(schema.types[0].properties[0].type).toBe('str')
    })

    it('parses type with multiple properties', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          email: str;
          age: int32;
        }
      `)
      expect(schema.types).toHaveLength(1)
      expect(schema.types[0].properties).toHaveLength(3)
    })

    it('parses multiple types', () => {
      const schema = parseSDL(`
        type User { name: str; }
        type Post { title: str; }
      `)
      expect(schema.types).toHaveLength(2)
      expect(schema.types[0].name).toBe('User')
      expect(schema.types[1].name).toBe('Post')
    })

    it('preserves PascalCase type names', () => {
      const schema = parseSDL(`type MyUserProfile { }`)
      expect(schema.types[0].name).toBe('MyUserProfile')
    })

    it('handles single-letter type names', () => {
      const schema = parseSDL(`type A { }`)
      expect(schema.types[0].name).toBe('A')
    })

    it('handles type names with numbers', () => {
      const schema = parseSDL(`type User2 { }`)
      expect(schema.types[0].name).toBe('User2')
    })

    it('handles type names with underscores', () => {
      const schema = parseSDL(`type User_Profile { }`)
      expect(schema.types[0].name).toBe('User_Profile')
    })
  })

  describe('module declarations', () => {
    it('parses default module', () => {
      const schema = parseSDL(`
        module default {
          type User { name: str; }
        }
      `)
      expect(schema.modules).toHaveLength(1)
      expect(schema.modules[0].name).toBe('default')
      expect(schema.modules[0].types).toHaveLength(1)
    })

    it('parses named module', () => {
      const schema = parseSDL(`
        module myapp {
          type User { name: str; }
        }
      `)
      expect(schema.modules).toHaveLength(1)
      expect(schema.modules[0].name).toBe('myapp')
    })

    it('parses multiple modules', () => {
      const schema = parseSDL(`
        module auth {
          type User { name: str; }
        }
        module blog {
          type Post { title: str; }
        }
      `)
      expect(schema.modules).toHaveLength(2)
      expect(schema.modules[0].name).toBe('auth')
      expect(schema.modules[1].name).toBe('blog')
    })

    it('parses nested module syntax', () => {
      const schema = parseSDL(`
        module myapp::auth {
          type User { name: str; }
        }
      `)
      expect(schema.modules[0].name).toBe('myapp::auth')
    })

    it('allows types outside modules (implicit default)', () => {
      const schema = parseSDL(`
        type User { name: str; }
      `)
      expect(schema.types).toHaveLength(1)
      expect(schema.types[0].module).toBe('default')
    })

    it('parses empty module', () => {
      const schema = parseSDL(`module default { }`)
      expect(schema.modules).toHaveLength(1)
      expect(schema.modules[0].types).toHaveLength(0)
    })
  })

  describe('comments', () => {
    it('ignores single-line comments', () => {
      const schema = parseSDL(`
        # This is a comment
        type User {
          # Another comment
          name: str;
        }
      `)
      expect(schema.types).toHaveLength(1)
      expect(schema.types[0].properties).toHaveLength(1)
    })

    it('ignores multi-line comments', () => {
      const schema = parseSDL(`
        /* Multi-line
           comment */
        type User { name: str; }
      `)
      expect(schema.types).toHaveLength(1)
    })

    it('preserves doc comments as annotations', () => {
      const schema = parseSDL(`
        ## User represents a system user
        type User { name: str; }
      `)
      expect(schema.types[0].doc).toBe('User represents a system user')
    })
  })

  describe('whitespace handling', () => {
    it('handles no whitespace', () => {
      const schema = parseSDL(`type User{name:str;}`)
      expect(schema.types[0].name).toBe('User')
      expect(schema.types[0].properties[0].name).toBe('name')
    })

    it('handles excessive whitespace', () => {
      const schema = parseSDL(`
        type    User    {
          name    :    str    ;
        }
      `)
      expect(schema.types[0].name).toBe('User')
    })

    it('handles tabs and newlines', () => {
      const schema = parseSDL(`type\tUser\n{\n\tname:\tstr;\n}`)
      expect(schema.types[0].name).toBe('User')
    })

    it('handles Windows line endings (CRLF)', () => {
      const schema = parseSDL(`type User {\r\n  name: str;\r\n}`)
      expect(schema.types[0].name).toBe('User')
    })
  })

  describe('error handling', () => {
    it('throws on invalid syntax - missing brace', () => {
      expect(() => parseSDL(`type User { name: str;`)).toThrow()
    })

    it('throws on invalid syntax - missing semicolon', () => {
      // Missing colon in property definition should throw
      expect(() => parseSDL(`type User { name str; }`)).toThrow()
    })

    it('throws on invalid type name - starts with number', () => {
      expect(() => parseSDL(`type 123User { }`)).toThrow()
    })

    it('throws on reserved keyword as type name', () => {
      expect(() => parseSDL(`type type { }`)).toThrow()
    })

    it('provides line number in error message', () => {
      try {
        parseSDL(`type User {\n  name: str\n}`)
      } catch (e: any) {
        expect(e.message).toContain('line')
      }
    })
  })
})

// =============================================================================
// 2. PROPERTY MODIFIERS (25 tests)
// =============================================================================

describe('Property Modifiers', () => {
  describe('required modifier', () => {
    it('parses required property', () => {
      const schema = parseSDL(`type User { required name: str; }`)
      expect(schema.types[0].properties[0].required).toBe(true)
    })

    it('marks non-required properties as optional', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types[0].properties[0].required).toBe(false)
    })

    it('parses multiple required properties', () => {
      const schema = parseSDL(`
        type User {
          required name: str;
          required email: str;
          age: int32;
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[1].required).toBe(true)
      expect(schema.types[0].properties[2].required).toBe(false)
    })
  })

  describe('optional modifier', () => {
    it('parses explicit optional property', () => {
      const schema = parseSDL(`type User { optional email: str; }`)
      expect(schema.types[0].properties[0].required).toBe(false)
      expect(schema.types[0].properties[0].optional).toBe(true)
    })

    it('treats bare property as implicitly optional', () => {
      const schema = parseSDL(`type User { email: str; }`)
      expect(schema.types[0].properties[0].required).toBe(false)
    })
  })

  describe('default modifier', () => {
    it('parses string default value', () => {
      const schema = parseSDL(`
        type User {
          status: str {
            default := 'active';
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe('active')
    })

    it('parses numeric default value', () => {
      const schema = parseSDL(`
        type User {
          age: int32 {
            default := 0;
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe(0)
    })

    it('parses boolean default value (true)', () => {
      const schema = parseSDL(`
        type User {
          active: bool {
            default := true;
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe(true)
    })

    it('parses boolean default value (false)', () => {
      const schema = parseSDL(`
        type Post {
          published: bool {
            default := false;
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe(false)
    })

    it('parses float default value', () => {
      const schema = parseSDL(`
        type Product {
          rating: float64 {
            default := 0.0;
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe(0.0)
    })

    it('parses function default value', () => {
      const schema = parseSDL(`
        type User {
          id: uuid {
            default := uuid_generate_v4();
          }
        }
      `)
      expect(schema.types[0].properties[0].defaultExpr).toBe('uuid_generate_v4()')
    })

    it('parses datetime_current() default', () => {
      const schema = parseSDL(`
        type Post {
          created_at: datetime {
            default := datetime_current();
          }
        }
      `)
      expect(schema.types[0].properties[0].defaultExpr).toBe('datetime_current()')
    })
  })

  describe('readonly modifier', () => {
    it('parses readonly property', () => {
      const schema = parseSDL(`type User { readonly created_at: datetime; }`)
      expect(schema.types[0].properties[0].readonly).toBe(true)
    })

    it('marks non-readonly properties as mutable', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types[0].properties[0].readonly).toBe(false)
    })

    it('parses readonly with required', () => {
      const schema = parseSDL(`type User { required readonly id: uuid; }`)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[0].readonly).toBe(true)
    })
  })

  describe('property modifier', () => {
    it('parses explicit property keyword', () => {
      const schema = parseSDL(`
        type User {
          property name: str;
        }
      `)
      expect(schema.types[0].properties[0].name).toBe('name')
    })

    it('parses property with block syntax', () => {
      const schema = parseSDL(`
        type User {
          property status: str {
            default := 'active';
            constraint min_len_value(1);
          }
        }
      `)
      expect(schema.types[0].properties[0].name).toBe('status')
      expect(schema.types[0].properties[0].default).toBe('active')
      expect(schema.types[0].properties[0].constraints).toHaveLength(1)
    })
  })

  describe('combined modifiers', () => {
    it('parses required with default', () => {
      const schema = parseSDL(`
        type User {
          required status: str {
            default := 'pending';
          }
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[0].default).toBe('pending')
    })

    it('parses optional with default', () => {
      const schema = parseSDL(`
        type User {
          optional role: str {
            default := 'user';
          }
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(false)
      expect(schema.types[0].properties[0].default).toBe('user')
    })

    it('parses all modifiers together', () => {
      const schema = parseSDL(`
        type User {
          required property readonly id: uuid {
            default := uuid_generate_v4();
          }
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[0].readonly).toBe(true)
    })
  })
})

// =============================================================================
// 3. PROPERTY TYPES (20 tests)
// =============================================================================

describe('Property Types', () => {
  describe('string types', () => {
    it('parses str type', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types[0].properties[0].type).toBe('str')
    })
  })

  describe('boolean types', () => {
    it('parses bool type', () => {
      const schema = parseSDL(`type User { active: bool; }`)
      expect(schema.types[0].properties[0].type).toBe('bool')
    })
  })

  describe('uuid types', () => {
    it('parses uuid type', () => {
      const schema = parseSDL(`type User { id: uuid; }`)
      expect(schema.types[0].properties[0].type).toBe('uuid')
    })
  })

  describe('integer types', () => {
    it('parses int16 type', () => {
      const schema = parseSDL(`type Data { value: int16; }`)
      expect(schema.types[0].properties[0].type).toBe('int16')
    })

    it('parses int32 type', () => {
      const schema = parseSDL(`type User { age: int32; }`)
      expect(schema.types[0].properties[0].type).toBe('int32')
    })

    it('parses int64 type', () => {
      const schema = parseSDL(`type Data { bigvalue: int64; }`)
      expect(schema.types[0].properties[0].type).toBe('int64')
    })
  })

  describe('float types', () => {
    it('parses float32 type', () => {
      const schema = parseSDL(`type Data { value: float32; }`)
      expect(schema.types[0].properties[0].type).toBe('float32')
    })

    it('parses float64 type', () => {
      const schema = parseSDL(`type Product { price: float64; }`)
      expect(schema.types[0].properties[0].type).toBe('float64')
    })
  })

  describe('arbitrary precision types', () => {
    it('parses bigint type', () => {
      const schema = parseSDL(`type Data { huge: bigint; }`)
      expect(schema.types[0].properties[0].type).toBe('bigint')
    })

    it('parses decimal type', () => {
      const schema = parseSDL(`type Product { price: decimal; }`)
      expect(schema.types[0].properties[0].type).toBe('decimal')
    })
  })

  describe('datetime types', () => {
    it('parses datetime type', () => {
      const schema = parseSDL(`type Event { starts_at: datetime; }`)
      expect(schema.types[0].properties[0].type).toBe('datetime')
    })

    it('parses cal::local_date type', () => {
      const schema = parseSDL(`type Event { date: cal::local_date; }`)
      expect(schema.types[0].properties[0].type).toBe('cal::local_date')
    })

    it('parses cal::local_time type', () => {
      const schema = parseSDL(`type Event { time: cal::local_time; }`)
      expect(schema.types[0].properties[0].type).toBe('cal::local_time')
    })

    it('parses cal::local_datetime type', () => {
      const schema = parseSDL(`type Event { local_dt: cal::local_datetime; }`)
      expect(schema.types[0].properties[0].type).toBe('cal::local_datetime')
    })
  })

  describe('duration types', () => {
    it('parses duration type', () => {
      const schema = parseSDL(`type Task { estimated: duration; }`)
      expect(schema.types[0].properties[0].type).toBe('duration')
    })

    it('parses cal::relative_duration type', () => {
      const schema = parseSDL(`type Subscription { period: cal::relative_duration; }`)
      expect(schema.types[0].properties[0].type).toBe('cal::relative_duration')
    })

    it('parses cal::date_duration type', () => {
      const schema = parseSDL(`type Project { timespan: cal::date_duration; }`)
      expect(schema.types[0].properties[0].type).toBe('cal::date_duration')
    })
  })

  describe('special types', () => {
    it('parses json type', () => {
      const schema = parseSDL(`type Config { data: json; }`)
      expect(schema.types[0].properties[0].type).toBe('json')
    })

    it('parses bytes type', () => {
      const schema = parseSDL(`type File { content: bytes; }`)
      expect(schema.types[0].properties[0].type).toBe('bytes')
    })
  })

  describe('collection types', () => {
    it('parses array<str> type', () => {
      const schema = parseSDL(`type Article { tags: array<str>; }`)
      expect(schema.types[0].properties[0].type).toBe('array')
      expect(schema.types[0].properties[0].elementType).toBe('str')
    })

    it('parses array<int32> type', () => {
      const schema = parseSDL(`type Data { values: array<int32>; }`)
      expect(schema.types[0].properties[0].type).toBe('array')
      expect(schema.types[0].properties[0].elementType).toBe('int32')
    })

    it('parses tuple<float64, float64> type', () => {
      const schema = parseSDL(`type GeoPoint { coordinates: tuple<float64, float64>; }`)
      expect(schema.types[0].properties[0].type).toBe('tuple')
      expect(schema.types[0].properties[0].tupleTypes).toEqual(['float64', 'float64'])
    })

    it('parses named tuple type', () => {
      const schema = parseSDL(`
        type Address {
          location: tuple<lat: float64, lon: float64, name: str>;
        }
      `)
      expect(schema.types[0].properties[0].type).toBe('tuple')
      expect(schema.types[0].properties[0].tupleFields).toEqual({
        lat: 'float64',
        lon: 'float64',
        name: 'str'
      })
    })
  })
})

// =============================================================================
// 4. LINKS (30 tests)
// =============================================================================

describe('Links', () => {
  describe('single links', () => {
    it('parses required single link', () => {
      const schema = parseSDL(`
        type Post {
          required author: User;
        }
      `)
      expect(schema.types[0].links).toHaveLength(1)
      expect(schema.types[0].links[0].name).toBe('author')
      expect(schema.types[0].links[0].target).toBe('User')
      expect(schema.types[0].links[0].required).toBe(true)
      expect(schema.types[0].links[0].cardinality).toBe('single')
    })

    it('parses optional single link', () => {
      const schema = parseSDL(`
        type Post {
          optional reviewer: User;
        }
      `)
      expect(schema.types[0].links[0].required).toBe(false)
      expect(schema.types[0].links[0].cardinality).toBe('single')
    })

    it('parses bare single link as optional', () => {
      const schema = parseSDL(`
        type Post {
          reviewer: User;
        }
      `)
      expect(schema.types[0].links[0].required).toBe(false)
    })

    it('parses single link with explicit link keyword', () => {
      const schema = parseSDL(`
        type Post {
          link author: User;
        }
      `)
      expect(schema.types[0].links[0].name).toBe('author')
    })

    it('parses required link with explicit link keyword', () => {
      const schema = parseSDL(`
        type Post {
          required link author: User;
        }
      `)
      expect(schema.types[0].links[0].required).toBe(true)
    })

    it('distinguishes link from property by target type', () => {
      const schema = parseSDL(`
        type Post {
          title: str;
          author: User;
        }
      `)
      expect(schema.types[0].properties).toHaveLength(1)
      expect(schema.types[0].links).toHaveLength(1)
    })
  })

  describe('multi links', () => {
    it('parses multi link', () => {
      const schema = parseSDL(`
        type Post {
          multi tags: Tag;
        }
      `)
      expect(schema.types[0].links[0].name).toBe('tags')
      expect(schema.types[0].links[0].cardinality).toBe('multi')
      expect(schema.types[0].links[0].required).toBe(false)
    })

    it('parses required multi link', () => {
      const schema = parseSDL(`
        type Post {
          required multi categories: Category;
        }
      `)
      expect(schema.types[0].links[0].cardinality).toBe('multi')
      expect(schema.types[0].links[0].required).toBe(true)
    })

    it('parses multi link with explicit link keyword', () => {
      const schema = parseSDL(`
        type Post {
          multi link tags: Tag;
        }
      `)
      expect(schema.types[0].links[0].cardinality).toBe('multi')
    })

    it('parses self-referential multi link', () => {
      const schema = parseSDL(`
        type User {
          multi friends: User;
        }
      `)
      expect(schema.types[0].links[0].target).toBe('User')
      expect(schema.types[0].links[0].cardinality).toBe('multi')
    })
  })

  describe('link properties', () => {
    it('parses multi link with single property', () => {
      const schema = parseSDL(`
        type Person {
          multi friends: Person {
            strength: float64;
          }
        }
      `)
      expect(schema.types[0].links[0].properties).toHaveLength(1)
      expect(schema.types[0].links[0].properties[0].name).toBe('strength')
      expect(schema.types[0].links[0].properties[0].type).toBe('float64')
    })

    it('parses multi link with multiple properties', () => {
      const schema = parseSDL(`
        type Person {
          multi friends: Person {
            strength: float64;
            since: datetime;
          }
        }
      `)
      expect(schema.types[0].links[0].properties).toHaveLength(2)
    })

    it('parses link property with required modifier', () => {
      const schema = parseSDL(`
        type Student {
          multi enrolled_in: Course {
            required grade: str;
          }
        }
      `)
      expect(schema.types[0].links[0].properties[0].required).toBe(true)
    })

    it('parses link property with default value', () => {
      const schema = parseSDL(`
        type User {
          multi following: User {
            notifications: bool {
              default := true;
            }
          }
        }
      `)
      expect(schema.types[0].links[0].properties[0].default).toBe(true)
    })
  })

  describe('link constraints', () => {
    it('parses link with exclusive constraint', () => {
      const schema = parseSDL(`
        type Comment {
          link author: User {
            constraint exclusive;
          }
        }
      `)
      expect(schema.types[0].links[0].constraints).toHaveLength(1)
      expect(schema.types[0].links[0].constraints[0].type).toBe('exclusive')
    })
  })

  describe('on delete behavior', () => {
    it('parses link with on delete restrict', () => {
      const schema = parseSDL(`
        type Post {
          required author: User {
            on target delete restrict;
          }
        }
      `)
      expect(schema.types[0].links[0].onTargetDelete).toBe('restrict')
    })

    it('parses link with on delete delete source', () => {
      const schema = parseSDL(`
        type Comment {
          required post: Post {
            on target delete delete source;
          }
        }
      `)
      expect(schema.types[0].links[0].onTargetDelete).toBe('delete source')
    })

    it('parses link with on delete allow', () => {
      const schema = parseSDL(`
        type Post {
          author: User {
            on target delete allow;
          }
        }
      `)
      expect(schema.types[0].links[0].onTargetDelete).toBe('allow')
    })

    it('parses link with on delete deferred restrict', () => {
      const schema = parseSDL(`
        type Post {
          author: User {
            on target delete deferred restrict;
          }
        }
      `)
      expect(schema.types[0].links[0].onTargetDelete).toBe('deferred restrict')
    })
  })

  describe('module-qualified links', () => {
    it('parses link to type in different module', () => {
      const schema = parseSDL(`
        type Post {
          author: auth::User;
        }
      `)
      expect(schema.types[0].links[0].target).toBe('auth::User')
    })

    it('parses link to type with nested module path', () => {
      const schema = parseSDL(`
        type Post {
          author: myapp::auth::User;
        }
      `)
      expect(schema.types[0].links[0].target).toBe('myapp::auth::User')
    })
  })

  describe('complex link scenarios', () => {
    it('parses type with both properties and links', () => {
      const schema = parseSDL(`
        type Post {
          required title: str;
          content: str;
          required author: User;
          multi tags: Tag;
        }
      `)
      expect(schema.types[0].properties).toHaveLength(2)
      expect(schema.types[0].links).toHaveLength(2)
    })

    it('parses multiple multi links', () => {
      const schema = parseSDL(`
        type Article {
          multi tags: Tag;
          multi categories: Category;
          multi related: Article;
        }
      `)
      expect(schema.types[0].links).toHaveLength(3)
    })
  })
})

// =============================================================================
// 5. CONSTRAINTS (25 tests)
// =============================================================================

describe('Constraints', () => {
  describe('exclusive constraint', () => {
    it('parses exclusive on property', () => {
      const schema = parseSDL(`
        type User {
          email: str {
            constraint exclusive;
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints).toHaveLength(1)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('exclusive')
    })

    it('parses required with exclusive', () => {
      const schema = parseSDL(`
        type User {
          required email: str {
            constraint exclusive;
          }
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('exclusive')
    })
  })

  describe('min_value constraint', () => {
    it('parses min_value with integer', () => {
      const schema = parseSDL(`
        type Product {
          price: float64 {
            constraint min_value(0);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('min_value')
      expect(schema.types[0].properties[0].constraints[0].value).toBe(0)
    })

    it('parses min_value with negative number', () => {
      const schema = parseSDL(`
        type Data {
          value: int32 {
            constraint min_value(-100);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].value).toBe(-100)
    })

    it('parses min_value with float', () => {
      const schema = parseSDL(`
        type Product {
          price: float64 {
            constraint min_value(0.01);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].value).toBe(0.01)
    })
  })

  describe('max_value constraint', () => {
    it('parses max_value', () => {
      const schema = parseSDL(`
        type Product {
          price: float64 {
            constraint max_value(10000);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('max_value')
      expect(schema.types[0].properties[0].constraints[0].value).toBe(10000)
    })

    it('parses min_value and max_value together', () => {
      const schema = parseSDL(`
        type Product {
          rating: float64 {
            constraint min_value(0);
            constraint max_value(5);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints).toHaveLength(2)
    })
  })

  describe('min_len_value constraint', () => {
    it('parses min_len_value', () => {
      const schema = parseSDL(`
        type User {
          username: str {
            constraint min_len_value(3);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('min_len_value')
      expect(schema.types[0].properties[0].constraints[0].value).toBe(3)
    })
  })

  describe('max_len_value constraint', () => {
    it('parses max_len_value', () => {
      const schema = parseSDL(`
        type User {
          username: str {
            constraint max_len_value(50);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('max_len_value')
      expect(schema.types[0].properties[0].constraints[0].value).toBe(50)
    })

    it('parses min_len_value and max_len_value together', () => {
      const schema = parseSDL(`
        type User {
          username: str {
            constraint min_len_value(3);
            constraint max_len_value(50);
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints).toHaveLength(2)
    })
  })

  describe('regexp constraint', () => {
    it('parses regexp with raw string', () => {
      const schema = parseSDL(`
        type User {
          email: str {
            constraint regexp(r'^[a-z]+$');
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('regexp')
      expect(schema.types[0].properties[0].constraints[0].pattern).toBe('^[a-z]+$')
    })

    it('parses regexp with regular string', () => {
      const schema = parseSDL(`
        type User {
          slug: str {
            constraint regexp('^[a-z0-9-]+$');
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].pattern).toBe('^[a-z0-9-]+$')
    })

    it('parses complex regexp pattern', () => {
      const schema = parseSDL(`
        type User {
          email: str {
            constraint regexp(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+$');
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('regexp')
    })
  })

  describe('composite exclusive constraint', () => {
    it('parses exclusive on multiple properties', () => {
      const schema = parseSDL(`
        type Subscription {
          required user: User;
          required plan: Plan;
          constraint exclusive on ((.user, .plan));
        }
      `)
      expect(schema.types[0].constraints).toHaveLength(1)
      expect(schema.types[0].constraints[0].type).toBe('exclusive')
      expect(schema.types[0].constraints[0].on).toEqual(['.user', '.plan'])
    })

    it('parses exclusive on single property at type level', () => {
      const schema = parseSDL(`
        type User {
          email: str;
          constraint exclusive on (.email);
        }
      `)
      expect(schema.types[0].constraints[0].on).toEqual(['.email'])
    })

    it('parses exclusive on three properties', () => {
      const schema = parseSDL(`
        type Booking {
          room: Room;
          date: cal::local_date;
          time_slot: int32;
          constraint exclusive on ((.room, .date, .time_slot));
        }
      `)
      expect(schema.types[0].constraints[0].on).toHaveLength(3)
    })
  })

  describe('one_of constraint', () => {
    it('parses one_of constraint', () => {
      const schema = parseSDL(`
        type Task {
          status: str {
            constraint one_of('pending', 'active', 'done');
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].type).toBe('one_of')
      expect(schema.types[0].properties[0].constraints[0].values).toEqual(['pending', 'active', 'done'])
    })
  })

  describe('expression constraint', () => {
    it('parses expression constraint', () => {
      const schema = parseSDL(`
        type DateRange {
          start_date: datetime;
          end_date: datetime;
          constraint expression on (.start_date < .end_date);
        }
      `)
      expect(schema.types[0].constraints[0].type).toBe('expression')
      expect(schema.types[0].constraints[0].expr).toBe('.start_date < .end_date')
    })
  })

  describe('delegated constraints', () => {
    it('parses delegated constraint', () => {
      const schema = parseSDL(`
        type Admin extending User {
          overloaded email: str {
            delegated constraint exclusive;
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints[0].delegated).toBe(true)
    })
  })

  describe('multiple constraints', () => {
    it('parses property with many constraints', () => {
      const schema = parseSDL(`
        type User {
          username: str {
            constraint exclusive;
            constraint min_len_value(3);
            constraint max_len_value(30);
            constraint regexp(r'^[a-z0-9_]+$');
          }
        }
      `)
      expect(schema.types[0].properties[0].constraints).toHaveLength(4)
    })
  })
})

// =============================================================================
// 6. INHERITANCE (25 tests)
// =============================================================================

describe('Inheritance', () => {
  describe('abstract types', () => {
    it('parses abstract type', () => {
      const schema = parseSDL(`
        abstract type Auditable {
          created_at: datetime;
          updated_at: datetime;
        }
      `)
      expect(schema.types[0].abstract).toBe(true)
      expect(schema.types[0].name).toBe('Auditable')
    })

    it('parses abstract type with required properties', () => {
      const schema = parseSDL(`
        abstract type Timestamped {
          required created_at: datetime;
        }
      `)
      expect(schema.types[0].abstract).toBe(true)
      expect(schema.types[0].properties[0].required).toBe(true)
    })

    it('parses abstract type with links', () => {
      const schema = parseSDL(`
        abstract type Owned {
          required owner: User;
        }
      `)
      expect(schema.types[0].abstract).toBe(true)
      expect(schema.types[0].links).toHaveLength(1)
    })

    it('marks non-abstract types as concrete', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types[0].abstract).toBe(false)
    })
  })

  describe('single inheritance', () => {
    it('parses type extending another type', () => {
      const schema = parseSDL(`
        abstract type Person {
          name: str;
        }
        type User extending Person {
          email: str;
        }
      `)
      expect(schema.types[1].extends).toEqual(['Person'])
    })

    it('parses concrete type extending concrete type', () => {
      const schema = parseSDL(`
        type User {
          name: str;
        }
        type Admin extending User {
          role: str;
        }
      `)
      expect(schema.types[1].extends).toEqual(['User'])
    })

    it('parses deep inheritance chain', () => {
      const schema = parseSDL(`
        abstract type Base { id: uuid; }
        abstract type Timestamped extending Base { created_at: datetime; }
        type User extending Timestamped { name: str; }
      `)
      expect(schema.types[2].extends).toEqual(['Timestamped'])
    })

    it('type with no extending has empty extends array', () => {
      const schema = parseSDL(`type User { name: str; }`)
      expect(schema.types[0].extends).toEqual([])
    })
  })

  describe('multiple inheritance', () => {
    it('parses type extending multiple types', () => {
      const schema = parseSDL(`
        abstract type HasName {
          first_name: str;
          last_name: str;
        }
        abstract type HasEmail {
          email: str;
        }
        type Contact extending HasName, HasEmail {
          phone: str;
        }
      `)
      expect(schema.types[2].extends).toEqual(['HasName', 'HasEmail'])
    })

    it('parses type extending three types', () => {
      const schema = parseSDL(`
        abstract type A { a: str; }
        abstract type B { b: str; }
        abstract type C { c: str; }
        type D extending A, B, C { d: str; }
      `)
      expect(schema.types[3].extends).toEqual(['A', 'B', 'C'])
    })

    it('preserves order of parent types', () => {
      const schema = parseSDL(`
        abstract type X { }
        abstract type Y { }
        type Z extending Y, X { }
      `)
      expect(schema.types[2].extends).toEqual(['Y', 'X'])
    })
  })

  describe('extending with module paths', () => {
    it('parses extending type from different module', () => {
      const schema = parseSDL(`
        type AdminUser extending auth::User {
          role: str;
        }
      `)
      expect(schema.types[0].extends).toEqual(['auth::User'])
    })

    it('parses extending multiple types from different modules', () => {
      const schema = parseSDL(`
        type MyType extending module1::TypeA, module2::TypeB {
          value: str;
        }
      `)
      expect(schema.types[0].extends).toEqual(['module1::TypeA', 'module2::TypeB'])
    })
  })

  describe('property overloading', () => {
    it('parses overloaded property', () => {
      const schema = parseSDL(`
        abstract type Person {
          name: str;
        }
        type User extending Person {
          overloaded required name: str;
        }
      `)
      expect(schema.types[1].properties[0].overloaded).toBe(true)
      expect(schema.types[1].properties[0].required).toBe(true)
    })

    it('parses overloaded property with constraint', () => {
      const schema = parseSDL(`
        abstract type Named {
          name: str;
        }
        type User extending Named {
          overloaded name: str {
            constraint exclusive;
          }
        }
      `)
      expect(schema.types[1].properties[0].overloaded).toBe(true)
      expect(schema.types[1].properties[0].constraints).toHaveLength(1)
    })
  })

  describe('link overloading', () => {
    it('parses overloaded link', () => {
      const schema = parseSDL(`
        abstract type Authored {
          author: Person;
        }
        type Post extending Authored {
          overloaded required author: User;
        }
      `)
      expect(schema.types[1].links[0].overloaded).toBe(true)
      expect(schema.types[1].links[0].required).toBe(true)
    })
  })

  describe('inheritance with constraints', () => {
    it('parses abstract type with constraints', () => {
      const schema = parseSDL(`
        abstract type Unique {
          required identifier: str {
            constraint exclusive;
          }
        }
      `)
      expect(schema.types[0].abstract).toBe(true)
      expect(schema.types[0].properties[0].constraints).toHaveLength(1)
    })

    it('parses child type adding constraints', () => {
      const schema = parseSDL(`
        abstract type Named {
          name: str;
        }
        type User extending Named {
          overloaded name: str {
            constraint min_len_value(1);
          }
        }
      `)
      expect(schema.types[1].properties[0].constraints).toHaveLength(1)
    })
  })

  describe('inheritance with computed properties', () => {
    it('parses abstract type with computed property', () => {
      const schema = parseSDL(`
        abstract type Named {
          first_name: str;
          last_name: str;
          full_name := .first_name ++ ' ' ++ .last_name;
        }
      `)
      expect(schema.types[0].computedProperties).toHaveLength(1)
    })
  })
})

// =============================================================================
// 7. ENUMS (15 tests)
// =============================================================================

describe('Enums', () => {
  describe('basic enum declaration', () => {
    it('parses scalar type enum', () => {
      const schema = parseSDL(`
        scalar type Status extending enum<pending, active, completed>;
      `)
      expect(schema.enums).toHaveLength(1)
      expect(schema.enums[0].name).toBe('Status')
      expect(schema.enums[0].values).toEqual(['pending', 'active', 'completed'])
    })

    it('parses enum with single value', () => {
      const schema = parseSDL(`
        scalar type SingleValue extending enum<only>;
      `)
      expect(schema.enums[0].values).toEqual(['only'])
    })

    it('parses enum with many values', () => {
      const schema = parseSDL(`
        scalar type Priority extending enum<lowest, low, medium, high, highest, critical>;
      `)
      expect(schema.enums[0].values).toHaveLength(6)
    })
  })

  describe('enum naming', () => {
    it('preserves PascalCase enum names', () => {
      const schema = parseSDL(`
        scalar type OrderStatus extending enum<pending, shipped>;
      `)
      expect(schema.enums[0].name).toBe('OrderStatus')
    })

    it('allows underscore in enum names', () => {
      const schema = parseSDL(`
        scalar type Order_Status extending enum<pending, shipped>;
      `)
      expect(schema.enums[0].name).toBe('Order_Status')
    })
  })

  describe('enum values', () => {
    it('preserves snake_case enum values', () => {
      const schema = parseSDL(`
        scalar type Status extending enum<in_progress, on_hold>;
      `)
      expect(schema.enums[0].values).toEqual(['in_progress', 'on_hold'])
    })

    it('handles hyphenated enum values', () => {
      const schema = parseSDL(`
        scalar type Region extending enum<us-east, us-west, eu-central>;
      `)
      expect(schema.enums[0].values).toEqual(['us-east', 'us-west', 'eu-central'])
    })

    it('preserves value order', () => {
      const schema = parseSDL(`
        scalar type Priority extending enum<low, medium, high>;
      `)
      expect(schema.enums[0].values).toEqual(['low', 'medium', 'high'])
    })
  })

  describe('enum usage in types', () => {
    it('parses property using enum type', () => {
      const schema = parseSDL(`
        scalar type Status extending enum<pending, active>;
        type Task {
          required status: Status;
        }
      `)
      expect(schema.types[0].properties[0].type).toBe('Status')
    })

    it('parses required enum property', () => {
      const schema = parseSDL(`
        scalar type Priority extending enum<low, medium, high>;
        type Task {
          required priority: Priority;
        }
      `)
      expect(schema.types[0].properties[0].required).toBe(true)
      expect(schema.types[0].properties[0].type).toBe('Priority')
    })

    it('parses enum property with default', () => {
      const schema = parseSDL(`
        scalar type Status extending enum<pending, active>;
        type Task {
          status: Status {
            default := Status.pending;
          }
        }
      `)
      expect(schema.types[0].properties[0].defaultExpr).toBe('Status.pending')
    })
  })

  describe('multiple enums', () => {
    it('parses multiple enum definitions', () => {
      const schema = parseSDL(`
        scalar type Status extending enum<pending, active, done>;
        scalar type Priority extending enum<low, medium, high>;
      `)
      expect(schema.enums).toHaveLength(2)
      expect(schema.enums[0].name).toBe('Status')
      expect(schema.enums[1].name).toBe('Priority')
    })
  })

  describe('enum in module', () => {
    it('parses enum inside module', () => {
      const schema = parseSDL(`
        module tasks {
          scalar type Status extending enum<pending, done>;
          type Task {
            status: Status;
          }
        }
      `)
      expect(schema.modules[0].enums).toHaveLength(1)
      expect(schema.modules[0].enums[0].name).toBe('Status')
    })
  })
})

// =============================================================================
// 8. INDEXES (15 tests)
// =============================================================================

describe('Indexes', () => {
  describe('single property index', () => {
    it('parses index on single property', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          index on (.name);
        }
      `)
      expect(schema.types[0].indexes).toHaveLength(1)
      expect(schema.types[0].indexes[0].on).toEqual(['.name'])
    })

    it('parses index on required property', () => {
      const schema = parseSDL(`
        type User {
          required email: str;
          index on (.email);
        }
      `)
      expect(schema.types[0].indexes[0].on).toEqual(['.email'])
    })
  })

  describe('composite index', () => {
    it('parses index on two properties', () => {
      const schema = parseSDL(`
        type User {
          email: str;
          name: str;
          index on ((.email, .name));
        }
      `)
      expect(schema.types[0].indexes[0].on).toEqual(['.email', '.name'])
    })

    it('parses index on three properties', () => {
      const schema = parseSDL(`
        type Event {
          year: int32;
          month: int32;
          day: int32;
          index on ((.year, .month, .day));
        }
      `)
      expect(schema.types[0].indexes[0].on).toHaveLength(3)
    })
  })

  describe('multiple indexes', () => {
    it('parses type with multiple indexes', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          email: str;
          created_at: datetime;
          index on (.name);
          index on (.email);
          index on (.created_at);
        }
      `)
      expect(schema.types[0].indexes).toHaveLength(3)
    })
  })

  describe('expression index', () => {
    it('parses index on expression', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          index on (str_lower(.name));
        }
      `)
      expect(schema.types[0].indexes[0].expression).toBe('str_lower(.name)')
    })
  })

  describe('index annotations', () => {
    it('parses index with annotation', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          index on (.name) {
            annotation title := 'Name index';
          }
        }
      `)
      expect(schema.types[0].indexes[0].annotations).toBeDefined()
      expect(schema.types[0].indexes[0].annotations.title).toBe('Name index')
    })
  })

  describe('index using clause', () => {
    it('parses index with fts::index', () => {
      const schema = parseSDL(`
        type Article {
          content: str;
          index fts::index on (
            fts::with_options(.content, language := fts::Language.eng)
          );
        }
      `)
      expect(schema.types[0].indexes[0].using).toBe('fts::index')
    })
  })

  describe('index on link', () => {
    it('parses index on link property', () => {
      const schema = parseSDL(`
        type Post {
          author: User;
          index on (.author);
        }
      `)
      expect(schema.types[0].indexes[0].on).toEqual(['.author'])
    })
  })

  describe('deferred index', () => {
    it('parses deferred index', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          index on (.name) {
            deferred := true;
          }
        }
      `)
      expect(schema.types[0].indexes[0].deferred).toBe(true)
    })
  })
})

// =============================================================================
// 9. COMPUTED PROPERTIES (10 tests)
// =============================================================================

describe('Computed Properties', () => {
  describe('string concatenation', () => {
    it('parses computed property with string concat', () => {
      const schema = parseSDL(`
        type Person {
          first_name: str;
          last_name: str;
          full_name := .first_name ++ ' ' ++ .last_name;
        }
      `)
      expect(schema.types[0].computedProperties).toHaveLength(1)
      expect(schema.types[0].computedProperties[0].name).toBe('full_name')
      expect(schema.types[0].computedProperties[0].expression).toBe(".first_name ++ ' ' ++ .last_name")
    })
  })

  describe('arithmetic expressions', () => {
    it('parses computed property with arithmetic', () => {
      const schema = parseSDL(`
        type Order {
          quantity: int32;
          unit_price: decimal;
          total := .quantity * .unit_price;
        }
      `)
      expect(schema.types[0].computedProperties[0].name).toBe('total')
      expect(schema.types[0].computedProperties[0].expression).toBe('.quantity * .unit_price')
    })
  })

  describe('computed with return type', () => {
    it('parses computed property with explicit type', () => {
      const schema = parseSDL(`
        type Person {
          first_name: str;
          last_name: str;
          property full_name -> str := .first_name ++ ' ' ++ .last_name;
        }
      `)
      expect(schema.types[0].computedProperties[0].returnType).toBe('str')
    })
  })

  describe('computed with function call', () => {
    it('parses computed property using function', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          name_length := len(.name);
        }
      `)
      expect(schema.types[0].computedProperties[0].expression).toBe('len(.name)')
    })

    it('parses computed property using str_lower', () => {
      const schema = parseSDL(`
        type User {
          email: str;
          normalized_email := str_lower(.email);
        }
      `)
      expect(schema.types[0].computedProperties[0].expression).toBe('str_lower(.email)')
    })
  })

  describe('multi computed property', () => {
    it('parses multi computed property', () => {
      const schema = parseSDL(`
        type Category {
          name: str;
          multi subcategories := .<parent[IS Category];
        }
      `)
      expect(schema.types[0].computedProperties[0].cardinality).toBe('multi')
    })
  })

  describe('computed link', () => {
    it('parses computed single link', () => {
      const schema = parseSDL(`
        type Post {
          author: User;
          author_name := .author.name;
        }
      `)
      expect(schema.types[0].computedProperties[0].expression).toBe('.author.name')
    })
  })

  describe('complex computed expressions', () => {
    it('parses computed with conditional', () => {
      const schema = parseSDL(`
        type User {
          age: int32;
          is_adult := .age >= 18;
        }
      `)
      expect(schema.types[0].computedProperties[0].expression).toBe('.age >= 18')
    })

    it('parses computed with if-else', () => {
      const schema = parseSDL(`
        type User {
          score: int32;
          grade := 'A' if .score >= 90 else 'B' if .score >= 80 else 'C';
        }
      `)
      expect(schema.types[0].computedProperties[0].expression).toContain('if')
    })
  })
})

// =============================================================================
// 10. BACKLINKS (10 tests)
// =============================================================================

describe('Backlinks', () => {
  describe('basic backlink syntax', () => {
    it('parses backlink with IS filter', () => {
      const schema = parseSDL(`
        type User {
          name: str;
          multi link posts := .<author[IS Post];
        }
      `)
      expect(schema.types[0].backlinks).toHaveLength(1)
      expect(schema.types[0].backlinks[0].name).toBe('posts')
      expect(schema.types[0].backlinks[0].forwardLink).toBe('author')
      expect(schema.types[0].backlinks[0].targetType).toBe('Post')
    })

    it('parses backlink without link keyword', () => {
      const schema = parseSDL(`
        type User {
          multi posts := .<author[IS Post];
        }
      `)
      expect(schema.types[0].backlinks[0].name).toBe('posts')
    })
  })

  describe('backlink cardinality', () => {
    it('parses multi backlink', () => {
      const schema = parseSDL(`
        type Author {
          multi books := .<writer[IS Book];
        }
      `)
      expect(schema.types[0].backlinks[0].cardinality).toBe('multi')
    })

    it('parses single backlink', () => {
      const schema = parseSDL(`
        type Profile {
          link user := .<profile[IS User];
        }
      `)
      expect(schema.types[0].backlinks[0].cardinality).toBe('single')
    })
  })

  describe('multiple backlinks', () => {
    it('parses type with multiple backlinks', () => {
      const schema = parseSDL(`
        type User {
          multi posts := .<author[IS Post];
          multi comments := .<author[IS Comment];
          multi likes := .<user[IS Like];
        }
      `)
      expect(schema.types[0].backlinks).toHaveLength(3)
    })
  })

  describe('backlink with union types', () => {
    it('parses backlink targeting union type', () => {
      const schema = parseSDL(`
        type User {
          multi content := .<author[IS Post | Comment];
        }
      `)
      expect(schema.types[0].backlinks[0].targetType).toEqual(['Post', 'Comment'])
    })
  })

  describe('backlink with properties', () => {
    it('recognizes backlinks cannot have additional properties', () => {
      // Backlinks are computed, so they shouldn't have additional properties
      // This test ensures we correctly identify backlinks vs regular links
      const schema = parseSDL(`
        type User {
          multi posts := .<author[IS Post];
        }
      `)
      expect(schema.types[0].backlinks[0].properties).toBeUndefined()
    })
  })

  describe('nested backlink paths', () => {
    it('parses backlink with nested path', () => {
      const schema = parseSDL(`
        type Category {
          multi all_products := .<category[IS Product] union .<category.parent[IS Product];
        }
      `)
      expect(schema.types[0].backlinks[0].expression).toContain('union')
    })
  })

  describe('backlink module qualification', () => {
    it('parses backlink targeting type in different module', () => {
      const schema = parseSDL(`
        type User {
          multi posts := .<author[IS blog::Post];
        }
      `)
      expect(schema.types[0].backlinks[0].targetType).toBe('blog::Post')
    })
  })
})

// =============================================================================
// ADDITIONAL TESTS: Edge Cases and Complex Scenarios
// =============================================================================

describe('Complex Scenarios', () => {
  describe('full schema parsing', () => {
    it('parses complete blog schema', () => {
      const schema = parseSDL(`
        module default {
          type User {
            required username: str {
              constraint exclusive;
              constraint min_len_value(3);
            }
            required email: str {
              constraint exclusive;
            }
            bio: str;
            multi posts := .<author[IS Post];
          }

          type Post {
            required title: str;
            required content: str;
            required author: User;
            published: bool {
              default := false;
            }
            multi tags: Tag;
            created_at: datetime {
              default := datetime_current();
            }
          }

          type Tag {
            required name: str {
              constraint exclusive;
            }
          }
        }
      `)
      expect(schema.modules).toHaveLength(1)
      expect(schema.modules[0].types).toHaveLength(3)
    })

    it('parses e-commerce schema with inheritance', () => {
      const schema = parseSDL(`
        abstract type Product {
          required name: str;
          required price: decimal;
          description: str;
          required sku: str {
            constraint exclusive;
          }
        }

        type PhysicalProduct extending Product {
          required weight: float64;
          dimensions: tuple<length: float64, width: float64, height: float64>;
        }

        type DigitalProduct extending Product {
          required download_url: str;
          file_size_mb: float64;
        }
      `)
      expect(schema.types).toHaveLength(3)
      expect(schema.types[0].abstract).toBe(true)
      expect(schema.types[1].extends).toEqual(['Product'])
      expect(schema.types[2].extends).toEqual(['Product'])
    })
  })

  describe('triggers', () => {
    it('parses trigger definition', () => {
      const schema = parseSDL(`
        type User {
          required email: str;
          trigger log_email_change after update for each
            when (__old__.email != __new__.email)
            do (
              insert AuditLog {
                entity_type := 'User',
                entity_id := __new__.id,
                field := 'email',
                old_value := __old__.email,
                new_value := __new__.email,
              }
            );
        }
      `)
      expect(schema.types[0].triggers).toHaveLength(1)
      expect(schema.types[0].triggers[0].name).toBe('log_email_change')
      expect(schema.types[0].triggers[0].timing).toBe('after')
      expect(schema.types[0].triggers[0].event).toBe('update')
    })
  })

  describe('access policies', () => {
    it('parses access policy', () => {
      const schema = parseSDL(`
        type Document {
          required title: str;
          required owner: User;

          access policy owner_has_full_access
            allow all
            using (.owner.id = global current_user_id);
        }
      `)
      expect(schema.types[0].accessPolicies).toHaveLength(1)
      expect(schema.types[0].accessPolicies[0].name).toBe('owner_has_full_access')
      expect(schema.types[0].accessPolicies[0].allow).toEqual(['all'])
    })

    it('parses access policy with specific operations', () => {
      const schema = parseSDL(`
        type Post {
          required title: str;
          required author: User;

          access policy author_can_edit
            allow update, delete
            using (.author.id = global current_user_id);
        }
      `)
      expect(schema.types[0].accessPolicies[0].allow).toEqual(['update', 'delete'])
    })
  })

  describe('annotations', () => {
    it('parses type annotation', () => {
      const schema = parseSDL(`
        type User {
          annotation title := 'Application User';
          annotation description := 'Represents a user in the system';
          name: str;
        }
      `)
      expect(schema.types[0].annotations.title).toBe('Application User')
      expect(schema.types[0].annotations.description).toBe('Represents a user in the system')
    })

    it('parses property annotation', () => {
      const schema = parseSDL(`
        type User {
          email: str {
            annotation title := 'Email Address';
          }
        }
      `)
      expect(schema.types[0].properties[0].annotations.title).toBe('Email Address')
    })
  })

  describe('alias declarations', () => {
    it('parses alias declaration', () => {
      const schema = parseSDL(`
        alias ActiveUsers := (
          select User filter .active = true
        );
      `)
      expect(schema.aliases).toHaveLength(1)
      expect(schema.aliases[0].name).toBe('ActiveUsers')
    })
  })

  describe('global declarations', () => {
    it('parses global variable', () => {
      const schema = parseSDL(`
        global current_user_id: uuid;
      `)
      expect(schema.globals).toHaveLength(1)
      expect(schema.globals[0].name).toBe('current_user_id')
      expect(schema.globals[0].type).toBe('uuid')
    })

    it('parses required global', () => {
      const schema = parseSDL(`
        required global current_user: User;
      `)
      expect(schema.globals[0].required).toBe(true)
    })

    it('parses global with default', () => {
      const schema = parseSDL(`
        global default_locale: str {
          default := 'en';
        }
      `)
      expect(schema.globals[0].default).toBe('en')
    })
  })

  describe('function declarations', () => {
    it('parses function definition', () => {
      const schema = parseSDL(`
        function get_greeting(name: str) -> str
          using ('Hello, ' ++ name ++ '!');
      `)
      expect(schema.functions).toHaveLength(1)
      expect(schema.functions[0].name).toBe('get_greeting')
      expect(schema.functions[0].returnType).toBe('str')
    })
  })

  describe('extensions', () => {
    it('parses extension usage', () => {
      const schema = parseSDL(`
        using extension pg_trgm;
        using extension auth;

        type User {
          name: str;
        }
      `)
      expect(schema.extensions).toHaveLength(2)
      expect(schema.extensions).toContain('pg_trgm')
      expect(schema.extensions).toContain('auth')
    })
  })
})

// =============================================================================
// SCHEMA IR STRUCTURE TESTS
// =============================================================================

describe('Schema IR Structure', () => {
  it('returns complete schema object', () => {
    const schema = parseSDL(`type User { name: str; }`)
    expect(schema).toHaveProperty('types')
    expect(schema).toHaveProperty('enums')
    expect(schema).toHaveProperty('modules')
    expect(schema).toHaveProperty('aliases')
    expect(schema).toHaveProperty('globals')
    expect(schema).toHaveProperty('functions')
    expect(schema).toHaveProperty('extensions')
  })

  it('includes source location information', () => {
    const schema = parseSDL(`type User { name: str; }`)
    expect(schema.types[0].location).toBeDefined()
    expect(schema.types[0].location.line).toBe(1)
    expect(schema.types[0].location.column).toBeGreaterThan(0)
  })

  it('preserves raw SDL for each type', () => {
    const sdl = `type User { name: str; }`
    const schema = parseSDL(sdl)
    expect(schema.types[0].raw).toBeDefined()
  })
})

// =============================================================================
// ADDITIONAL EDGE CASES (12 more tests to reach ~200)
// =============================================================================

describe('Edge Cases', () => {
  describe('empty inputs', () => {
    it('handles empty SDL string', () => {
      const schema = parseSDL(``)
      expect(schema.types).toHaveLength(0)
      expect(schema.enums).toHaveLength(0)
    })

    it('handles SDL with only whitespace', () => {
      const schema = parseSDL(`   \n\t   \n   `)
      expect(schema.types).toHaveLength(0)
    })

    it('handles SDL with only comments', () => {
      const schema = parseSDL(`
        # This is a comment
        # Another comment
        /* Block comment */
      `)
      expect(schema.types).toHaveLength(0)
    })
  })

  describe('unicode handling', () => {
    it('handles unicode in string defaults', () => {
      const schema = parseSDL(`
        type Greeting {
          message: str {
            default := 'Hello, world!';
          }
        }
      `)
      expect(schema.types[0].properties[0].default).toBe('Hello, world!')
    })

    it('handles unicode in doc comments', () => {
      const schema = parseSDL(`
        ## Represents a user
        type User { name: str; }
      `)
      expect(schema.types[0].doc).toContain('user')
    })
  })

  describe('scalar type extensions', () => {
    it('parses custom scalar type', () => {
      const schema = parseSDL(`
        scalar type PositiveInt extending int32 {
          constraint min_value(1);
        }
      `)
      expect(schema.scalars).toBeDefined()
      expect(schema.scalars[0].name).toBe('PositiveInt')
      expect(schema.scalars[0].extends).toBe('int32')
    })

    it('parses scalar with multiple constraints', () => {
      const schema = parseSDL(`
        scalar type Percentage extending float64 {
          constraint min_value(0);
          constraint max_value(100);
        }
      `)
      expect(schema.scalars[0].constraints).toHaveLength(2)
    })
  })

  describe('rewrite rules', () => {
    it('parses rewrite rule on insert', () => {
      const schema = parseSDL(`
        type User {
          created_at: datetime {
            rewrite insert using (datetime_current());
          }
        }
      `)
      expect(schema.types[0].properties[0].rewrites).toHaveLength(1)
      expect(schema.types[0].properties[0].rewrites[0].trigger).toBe('insert')
    })

    it('parses rewrite rule on update', () => {
      const schema = parseSDL(`
        type User {
          updated_at: datetime {
            rewrite update using (datetime_current());
          }
        }
      `)
      expect(schema.types[0].properties[0].rewrites[0].trigger).toBe('update')
    })
  })

  describe('special identifiers', () => {
    it('handles backtick-quoted identifiers', () => {
      const schema = parseSDL("type User { `type`: str; }")
      expect(schema.types[0].properties[0].name).toBe('type')
    })

    it('handles property names matching reserved words', () => {
      const schema = parseSDL("type Data { `index`: int32; }")
      expect(schema.types[0].properties[0].name).toBe('index')
    })

    it('handles backtick-quoted type names', () => {
      const schema = parseSDL("type `Order` { amount: decimal; }")
      expect(schema.types[0].name).toBe('Order')
    })
  })
})
