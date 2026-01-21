/**
 * Relation Operators Tests (do-lekf.5)
 *
 * Tests for IceType relation operators in schema parsing:
 *   -> Forward exact: auto-populate foreign key
 *   <- Backward: enable reverse lookups
 *   ~> Forward fuzzy: AI-matched semantic reference
 *   <~ Backward fuzzy: AI-matched backlink
 *
 * Helper functions:
 *   hasOne, hasMany, belongsTo, manyToMany, fuzzyRelation, fuzzyBackref
 *
 * NOTE: CRUD tests with WorkflowContext are in do/tests/entity-proxy.test.ts
 * This file focuses on the schema parsing and helper functions.
 *
 * @module do/tests/relation-operators.test
 */
import { describe, it, expect } from 'vitest'
import {
  parseSchema,
  parseRelation,
  hasOne,
  hasMany,
  belongsTo,
  manyToMany,
  fuzzyRelation,
  fuzzyBackref,
} from '../schema/parser'

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Helper to check if relations Map has a key (handles both Map and plain object)
 */
function hasRelation(relations: Map<string, unknown> | Record<string, unknown>, key: string): boolean {
  if (relations instanceof Map) {
    return relations.has(key)
  }
  return key in relations
}

/**
 * Helper to get relation from Map or plain object
 */
function getRelation<T>(relations: Map<string, T> | Record<string, T>, key: string): T | undefined {
  if (relations instanceof Map) {
    return relations.get(key)
  }
  return (relations as Record<string, T>)[key]
}

// =============================================================================
// RELATION OPERATOR HELPER FUNCTIONS TESTS
// =============================================================================

describe('Relation Operator Helpers (do-lekf.5)', () => {
  describe('hasOne()', () => {
    it('should create forward exact relation', () => {
      expect(hasOne('Customer')).toBe('-> Customer')
    })

    it('should create optional forward relation', () => {
      expect(hasOne('Customer', { optional: true })).toBe('-> Customer?')
    })

    it('should parse correctly via parseRelation', () => {
      const result = parseRelation(hasOne('Customer'))
      expect(result.operator).toBe('->')
      expect(result.direction).toBe('forward')
      expect(result.matchMode).toBe('exact')
      expect(result.targetType).toBe('Customer')
    })
  })

  describe('hasMany()', () => {
    it('should create backward relation with array', () => {
      expect(hasMany('Order', 'customer')).toBe('<- Order.customer[]')
    })

    it('should parse correctly via parseRelation', () => {
      const result = parseRelation(hasMany('Order', 'customer'))
      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.targetType).toBe('Order')
      expect(result.backref).toBe('customer')
      expect(result.array).toBe(true)
    })
  })

  describe('belongsTo()', () => {
    it('should create forward relation (alias for hasOne)', () => {
      expect(belongsTo('Order')).toBe('-> Order')
    })

    it('should create optional belongsTo relation', () => {
      expect(belongsTo('Order', { optional: true })).toBe('-> Order?')
    })
  })

  describe('manyToMany()', () => {
    it('should create backward relation through junction table', () => {
      expect(manyToMany('Course', 'Enrollment', 'student')).toBe('<- Enrollment.student[]')
    })

    it('should parse correctly via parseRelation', () => {
      const result = parseRelation(manyToMany('Course', 'Enrollment', 'student'))
      expect(result.operator).toBe('<-')
      expect(result.direction).toBe('backward')
      expect(result.targetType).toBe('Enrollment')
      expect(result.backref).toBe('student')
      expect(result.array).toBe(true)
    })
  })

  describe('fuzzyRelation()', () => {
    it('should create forward fuzzy relation', () => {
      expect(fuzzyRelation('Category')).toBe('~> Category')
    })

    it('should create fuzzy relation with threshold', () => {
      expect(fuzzyRelation('Category', { threshold: 0.8 })).toBe('~> Category(0.8)')
    })

    it('should create optional fuzzy relation', () => {
      expect(fuzzyRelation('Category', { optional: true })).toBe('~> Category?')
    })

    it('should create fuzzy relation with threshold and optional', () => {
      expect(fuzzyRelation('Category', { threshold: 0.8, optional: true })).toBe('~> Category(0.8)?')
    })

    it('should parse correctly via parseRelation', () => {
      const result = parseRelation(fuzzyRelation('Category', { threshold: 0.85 }))
      expect(result.operator).toBe('~>')
      expect(result.direction).toBe('forward')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.targetType).toBe('Category')
      expect(result.threshold).toBe(0.85)
    })
  })

  describe('fuzzyBackref()', () => {
    it('should create backward fuzzy relation', () => {
      expect(fuzzyBackref('Product', 'category')).toBe('<~ Product.category')
    })

    it('should create backward fuzzy relation with array', () => {
      expect(fuzzyBackref('Product', 'category', { array: true })).toBe('<~ Product.category[]')
    })

    it('should create backward fuzzy relation with threshold', () => {
      expect(fuzzyBackref('Product', 'category', { threshold: 0.9 })).toBe('<~ Product.category(0.9)')
    })

    it('should parse correctly via parseRelation', () => {
      const result = parseRelation(fuzzyBackref('Product', 'category', { array: true }))
      expect(result.operator).toBe('<~')
      expect(result.direction).toBe('backward')
      expect(result.matchMode).toBe('fuzzy')
      expect(result.targetType).toBe('Product')
      expect(result.backref).toBe('category')
      expect(result.array).toBe(true)
    })
  })
})

// =============================================================================
// SCHEMA PARSING WITH RELATION HELPERS TESTS
// =============================================================================

describe('Schema Parsing with Relation Helpers', () => {
  it('should parse schema with hasOne relations', () => {
    const schema = parseSchema({
      Order: {
        total: 'decimal(10,2)!',
        customer: hasOne('Customer'),
      },
      Customer: {
        name: 'string!',
      },
    })

    const order = schema.entities.get('Order')!
    expect(hasRelation(order.relations, 'customer')).toBe(true)
    expect(getRelation(order.relations, 'customer')!.targetType).toBe('Customer')
    expect(getRelation(order.relations, 'customer')!.direction).toBe('forward')
  })

  it('should parse schema with hasMany relations', () => {
    const schema = parseSchema({
      Customer: {
        name: 'string!',
        orders: hasMany('Order', 'customer'),
      },
      Order: {
        total: 'decimal(10,2)!',
        customer: hasOne('Customer'),
      },
    })

    const customer = schema.entities.get('Customer')!
    expect(hasRelation(customer.relations, 'orders')).toBe(true)
    expect(getRelation(customer.relations, 'orders')!.targetType).toBe('Order')
    expect(getRelation(customer.relations, 'orders')!.direction).toBe('backward')
    expect(getRelation(customer.relations, 'orders')!.array).toBe(true)
  })

  it('should parse schema with belongsTo relations', () => {
    const schema = parseSchema({
      OrderItem: {
        quantity: 'int!',
        order: belongsTo('Order'),
        product: belongsTo('Product'),
      },
      Order: {
        total: 'decimal(10,2)!',
      },
      Product: {
        name: 'string!',
      },
    })

    const orderItem = schema.entities.get('OrderItem')!
    expect(hasRelation(orderItem.relations, 'order')).toBe(true)
    expect(hasRelation(orderItem.relations, 'product')).toBe(true)
    expect(getRelation(orderItem.relations, 'order')!.direction).toBe('forward')
    expect(getRelation(orderItem.relations, 'product')!.direction).toBe('forward')
  })

  it('should parse schema with many-to-many relations', () => {
    const schema = parseSchema({
      Student: {
        name: 'string!',
        enrollments: manyToMany('Course', 'Enrollment', 'student'),
      },
      Course: {
        title: 'string!',
        enrollments: manyToMany('Student', 'Enrollment', 'course'),
      },
      Enrollment: {
        student: belongsTo('Student'),
        course: belongsTo('Course'),
        enrolledAt: 'timestamp!',
      },
    })

    const student = schema.entities.get('Student')!
    const course = schema.entities.get('Course')!
    const enrollment = schema.entities.get('Enrollment')!

    expect(hasRelation(student.relations, 'enrollments')).toBe(true)
    expect(hasRelation(course.relations, 'enrollments')).toBe(true)
    expect(hasRelation(enrollment.relations, 'student')).toBe(true)
    expect(hasRelation(enrollment.relations, 'course')).toBe(true)
  })

  it('should parse schema with fuzzy relations', () => {
    const schema = parseSchema({
      Product: {
        name: 'string!',
        category: fuzzyRelation('Category', { threshold: 0.85 }),
      },
      Category: {
        name: 'string!',
        products: fuzzyBackref('Product', 'category', { array: true }),
      },
    })

    const product = schema.entities.get('Product')!
    const category = schema.entities.get('Category')!

    expect(getRelation(product.relations, 'category')!.matchMode).toBe('fuzzy')
    expect(getRelation(product.relations, 'category')!.threshold).toBe(0.85)
    expect(getRelation(category.relations, 'products')!.matchMode).toBe('fuzzy')
    expect(getRelation(category.relations, 'products')!.array).toBe(true)
  })
})

// =============================================================================
// COMBINED SCHEMA TESTS
// =============================================================================

describe('Combined Schema with Relations', () => {
  it('should parse complex schema with all relation types', () => {
    const schema = parseSchema({
      User: {
        email: 'string!#',
        name: 'string!',
        posts: hasMany('Post', 'author'),
        profile: hasOne('Profile'),
      },
      Profile: {
        bio: 'string',
        user: belongsTo('User'),
      },
      Post: {
        title: 'string!',
        content: 'markdown',
        author: belongsTo('User'),
        tags: fuzzyRelation('Tag'),
      },
      Tag: {
        name: 'string!#',
        posts: fuzzyBackref('Post', 'tags', { array: true }),
      },
    })

    expect(schema.entities.size).toBe(4)

    // User has hasMany and hasOne
    const user = schema.entities.get('User')!
    expect(hasRelation(user.relations, 'posts')).toBe(true)
    expect(hasRelation(user.relations, 'profile')).toBe(true)
    expect(getRelation(user.relations, 'posts')!.direction).toBe('backward')
    expect(getRelation(user.relations, 'profile')!.direction).toBe('forward')

    // Post has belongsTo and fuzzy relation
    const post = schema.entities.get('Post')!
    expect(hasRelation(post.relations, 'author')).toBe(true)
    expect(hasRelation(post.relations, 'tags')).toBe(true)
    expect(getRelation(post.relations, 'tags')!.matchMode).toBe('fuzzy')

    // Tag has fuzzy backref
    const tag = schema.entities.get('Tag')!
    expect(hasRelation(tag.relations, 'posts')).toBe(true)
    expect(getRelation(tag.relations, 'posts')!.matchMode).toBe('fuzzy')
    expect(getRelation(tag.relations, 'posts')!.array).toBe(true)
  })

  it('should handle e-commerce schema example from issue', () => {
    // Example from do-lekf.5 issue description
    const schema = parseSchema({
      Order: {
        total: 'decimal(10,2)!',
        customer: hasOne('Customer'),
        items: hasMany('OrderItem', 'order'),
      },
      Customer: {
        name: 'string!',
        orders: hasMany('Order', 'customer'),
      },
      OrderItem: {
        quantity: 'int!',
        order: belongsTo('Order'),
        product: belongsTo('Product'),
      },
      Product: {
        name: 'string!',
        sku: 'string!#',
      },
    })

    expect(schema.entities.size).toBe(4)

    // Check Order relations
    const order = schema.entities.get('Order')!
    expect(getRelation(order.relations, 'customer')!.targetType).toBe('Customer')
    expect(getRelation(order.relations, 'items')!.targetType).toBe('OrderItem')
    expect(getRelation(order.relations, 'items')!.array).toBe(true)

    // Check OrderItem relations
    const orderItem = schema.entities.get('OrderItem')!
    expect(getRelation(orderItem.relations, 'order')!.targetType).toBe('Order')
    expect(getRelation(orderItem.relations, 'product')!.targetType).toBe('Product')
  })
})
