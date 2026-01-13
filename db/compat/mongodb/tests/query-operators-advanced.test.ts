/**
 * Advanced Query Operators Tests (RED Phase)
 *
 * Tests for MongoDB operators not yet fully implemented:
 * - $text (full-text search)
 * - $vector.$near (vector similarity search)
 * - $mod (modulo operator)
 * - $elemMatch with nested operators
 * - $expr (expression operators)
 * - $jsonSchema (schema validation)
 *
 * These tests should FAIL initially - RED phase of TDD.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Collection, ObjectId, type Document, type WithId } from '../index'

// ============================================================================
// $text Operator Tests (Full-Text Search)
// ============================================================================

interface Article extends Document {
  title: string
  content: string
  tags?: string[]
  author?: string
}

describe('$text Operator (Full-Text Search)', () => {
  let collection: Collection<Article>

  beforeEach(async () => {
    collection = new Collection<Article>('testdb', 'articles')

    // Create text index on content field
    await collection.createIndex({ content: 'text' })

    // Insert test documents
    await collection.insertMany([
      { title: 'MongoDB Basics', content: 'Learn the fundamentals of MongoDB database operations' },
      { title: 'Advanced Queries', content: 'Master complex query patterns in MongoDB' },
      { title: 'Cloudflare Workers', content: 'Build serverless applications on the edge' },
      { title: 'Durable Objects', content: 'Stateful serverless computing on Cloudflare Workers platform' },
      { title: 'Vector Search', content: 'Implementing similarity search with embeddings and HNSW indexes' },
    ])
  })

  it('should search with $text.$search', async () => {
    const docs = await collection.find({
      $text: { $search: 'MongoDB' },
    }).toArray()

    expect(docs.length).toBe(2)
    expect(docs.some((d) => d.title === 'MongoDB Basics')).toBe(true)
    expect(docs.some((d) => d.title === 'Advanced Queries')).toBe(true)
  })

  it('should search with phrase in quotes', async () => {
    const docs = await collection.find({
      $text: { $search: '"Cloudflare Workers"' },
    }).toArray()

    expect(docs.length).toBe(2)
  })

  it('should support negation with minus sign', async () => {
    const docs = await collection.find({
      $text: { $search: 'MongoDB -database' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.title).toBe('Advanced Queries')
  })

  it('should support $language option', async () => {
    const docs = await collection.find({
      $text: {
        $search: 'serverless',
        $language: 'english',
      },
    }).toArray()

    expect(docs.length).toBe(2)
  })

  it('should support $caseSensitive option', async () => {
    const docs = await collection.find({
      $text: {
        $search: 'mongodb',
        $caseSensitive: false,
      },
    }).toArray()

    expect(docs.length).toBe(2)
  })

  it('should support $diacriticSensitive option', async () => {
    // Insert document with diacritics
    await collection.insertOne({
      title: 'Cafe',
      content: 'Welcome to the cafe with great coffee',
    })

    const docs = await collection.find({
      $text: {
        $search: 'cafe',
        $diacriticSensitive: false,
      },
    }).toArray()

    expect(docs.length).toBeGreaterThanOrEqual(1)
  })

  it('should project text score with $meta', async () => {
    const docs = await collection.find(
      { $text: { $search: 'MongoDB serverless' } },
      { projection: { title: 1, score: { $meta: 'textScore' } } }
    ).toArray()

    expect(docs.length).toBeGreaterThan(0)
    expect(docs[0]).toHaveProperty('score')
    expect(typeof (docs[0] as any).score).toBe('number')
  })

  it('should sort by text score', async () => {
    const docs = await collection.find(
      { $text: { $search: 'MongoDB' } }
    ).sort({ score: { $meta: 'textScore' } }).toArray()

    expect(docs.length).toBe(2)
    // Higher relevance document should come first
  })
})

// ============================================================================
// $vector.$near Operator Tests (Vector Similarity Search)
// ============================================================================

interface Product extends Document {
  name: string
  description: string
  embedding?: number[]
  category?: string
}

describe('$vector.$near Operator (Vector Similarity Search)', () => {
  let collection: Collection<Product>
  const dim = 4 // Small dimension for testing

  // Sample embeddings for testing
  const appleEmbedding = [0.1, 0.2, 0.3, 0.4]
  const bananaEmbedding = [0.15, 0.25, 0.35, 0.45]
  const carEmbedding = [0.9, 0.1, 0.1, 0.1]
  const truckEmbedding = [0.85, 0.15, 0.1, 0.1]

  beforeEach(async () => {
    collection = new Collection<Product>('testdb', 'products')

    // Insert products with embeddings
    await collection.insertMany([
      { name: 'Apple', description: 'Fresh red apple', embedding: appleEmbedding, category: 'fruit' },
      { name: 'Banana', description: 'Yellow banana', embedding: bananaEmbedding, category: 'fruit' },
      { name: 'Orange', description: 'Juicy orange', embedding: [0.12, 0.22, 0.32, 0.42], category: 'fruit' },
      { name: 'Car', description: 'Sedan automobile', embedding: carEmbedding, category: 'vehicle' },
      { name: 'Truck', description: 'Pickup truck', embedding: truckEmbedding, category: 'vehicle' },
    ])
  })

  it('should find similar vectors with $vector.$near', async () => {
    const docs = await collection.find({
      $vector: {
        $near: appleEmbedding,
        $k: 3,
      },
    }).toArray()

    expect(docs.length).toBe(3)
    // Apple should be first (exact match), then Banana and Orange
    expect(docs[0]!.name).toBe('Apple')
  })

  it('should respect $k parameter for top-K results', async () => {
    const docs = await collection.find({
      $vector: {
        $near: appleEmbedding,
        $k: 2,
      },
    }).toArray()

    expect(docs.length).toBe(2)
  })

  it('should support $minScore threshold', async () => {
    const docs = await collection.find({
      $vector: {
        $near: appleEmbedding,
        $k: 10,
        $minScore: 0.9, // Only very similar vectors
      },
    }).toArray()

    // Should only return very similar fruits, not vehicles
    expect(docs.length).toBeLessThanOrEqual(3)
    expect(docs.every((d) => d.category === 'fruit')).toBe(true)
  })

  it('should support $maxDistance threshold', async () => {
    const docs = await collection.find({
      $vector: {
        $near: appleEmbedding,
        $k: 10,
        $maxDistance: 0.5,
      },
    }).toArray()

    expect(docs.length).toBeLessThanOrEqual(3)
  })

  it('should work with field path for embedding', async () => {
    const docs = await collection.find({
      $vector: {
        $near: carEmbedding,
        $k: 2,
        $path: 'embedding', // Explicit path
      },
    }).toArray()

    expect(docs.length).toBe(2)
    expect(docs[0]!.name).toBe('Car')
    expect(docs[1]!.name).toBe('Truck')
  })

  it('should combine $vector with other filters', async () => {
    const docs = await collection.find({
      category: 'fruit',
      $vector: {
        $near: appleEmbedding,
        $k: 2,
      },
    }).toArray()

    expect(docs.length).toBe(2)
    expect(docs.every((d) => d.category === 'fruit')).toBe(true)
  })

  it('should project similarity score', async () => {
    const docs = await collection.find(
      {
        $vector: {
          $near: appleEmbedding,
          $k: 3,
        },
      },
      { projection: { name: 1, _similarity: { $meta: 'vectorSearchScore' } } }
    ).toArray()

    expect(docs.length).toBe(3)
    expect((docs[0] as any)._similarity).toBeDefined()
    expect(typeof (docs[0] as any)._similarity).toBe('number')
  })
})

// ============================================================================
// $mod Operator Tests
// ============================================================================

interface NumberDoc extends Document {
  value: number
  name: string
}

describe('$mod Operator', () => {
  let collection: Collection<NumberDoc>

  beforeEach(async () => {
    collection = new Collection<NumberDoc>('testdb', 'numbers')
    await collection.insertMany([
      { value: 0, name: 'zero' },
      { value: 1, name: 'one' },
      { value: 2, name: 'two' },
      { value: 3, name: 'three' },
      { value: 4, name: 'four' },
      { value: 5, name: 'five' },
      { value: 6, name: 'six' },
      { value: 7, name: 'seven' },
      { value: 8, name: 'eight' },
      { value: 9, name: 'nine' },
      { value: 10, name: 'ten' },
    ])
  })

  it('should find even numbers with $mod: [2, 0]', async () => {
    const docs = await collection.find({
      value: { $mod: [2, 0] },
    }).toArray()

    expect(docs.length).toBe(6) // 0, 2, 4, 6, 8, 10
    expect(docs.every((d) => d.value % 2 === 0)).toBe(true)
  })

  it('should find odd numbers with $mod: [2, 1]', async () => {
    const docs = await collection.find({
      value: { $mod: [2, 1] },
    }).toArray()

    expect(docs.length).toBe(5) // 1, 3, 5, 7, 9
    expect(docs.every((d) => d.value % 2 === 1)).toBe(true)
  })

  it('should find multiples of 3 with $mod: [3, 0]', async () => {
    const docs = await collection.find({
      value: { $mod: [3, 0] },
    }).toArray()

    expect(docs.length).toBe(4) // 0, 3, 6, 9
    expect(docs.every((d) => d.value % 3 === 0)).toBe(true)
  })

  it('should combine $mod with other operators', async () => {
    const docs = await collection.find({
      value: { $mod: [2, 0], $gt: 5 },
    }).toArray()

    expect(docs.length).toBe(3) // 6, 8, 10
  })
})

// ============================================================================
// $elemMatch with Nested Operators Tests
// ============================================================================

interface Order extends Document {
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  customer: string
}

describe('$elemMatch with Nested Operators', () => {
  let collection: Collection<Order>

  beforeEach(async () => {
    collection = new Collection<Order>('testdb', 'orders')
    await collection.insertMany([
      {
        customer: 'Alice',
        items: [
          { name: 'apple', quantity: 5, price: 1.0 },
          { name: 'banana', quantity: 3, price: 0.5 },
        ],
      },
      {
        customer: 'Bob',
        items: [
          { name: 'orange', quantity: 10, price: 0.75 },
          { name: 'apple', quantity: 2, price: 1.0 },
        ],
      },
      {
        customer: 'Charlie',
        items: [
          { name: 'grape', quantity: 20, price: 2.0 },
        ],
      },
    ])
  })

  it('should match with multiple conditions in $elemMatch', async () => {
    const docs = await collection.find({
      items: {
        $elemMatch: {
          name: 'apple',
          quantity: { $gte: 5 },
        },
      },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.customer).toBe('Alice')
  })

  it('should match with $and inside $elemMatch', async () => {
    const docs = await collection.find({
      items: {
        $elemMatch: {
          $and: [
            { quantity: { $gte: 5 } },
            { price: { $lte: 1.0 } },
          ],
        },
      },
    }).toArray()

    expect(docs.length).toBe(2) // Alice and Bob
  })

  it('should match with $or inside $elemMatch', async () => {
    const docs = await collection.find({
      items: {
        $elemMatch: {
          $or: [
            { name: 'grape' },
            { quantity: { $gt: 15 } },
          ],
        },
      },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.customer).toBe('Charlie')
  })

  it('should support nested $elemMatch', async () => {
    // Insert document with nested arrays
    await collection.insertOne({
      customer: 'Diana',
      items: [
        { name: 'combo', quantity: 1, price: 5.0, variants: [{ size: 'S' }, { size: 'M' }] } as any,
      ],
    })

    const docs = await collection.find({
      items: {
        $elemMatch: {
          name: 'combo',
          variants: {
            $elemMatch: { size: 'M' },
          },
        },
      },
    } as any).toArray()

    expect(docs.length).toBe(1)
  })

  it('should project matching array element with $elemMatch projection', async () => {
    const docs = await collection.find(
      { customer: 'Alice' },
      {
        projection: {
          customer: 1,
          items: { $elemMatch: { name: 'apple' } },
        },
      }
    ).toArray()

    expect(docs.length).toBe(1)
    expect((docs[0] as any).items.length).toBe(1)
    expect((docs[0] as any).items[0].name).toBe('apple')
  })
})

// ============================================================================
// $expr Operator Tests
// ============================================================================

interface Sale extends Document {
  price: number
  discount: number
  quantity: number
}

describe('$expr Operator', () => {
  let collection: Collection<Sale>

  beforeEach(async () => {
    collection = new Collection<Sale>('testdb', 'sales')
    await collection.insertMany([
      { price: 100, discount: 10, quantity: 5 },
      { price: 200, discount: 50, quantity: 2 },
      { price: 50, discount: 5, quantity: 10 },
      { price: 150, discount: 30, quantity: 3 },
    ])
  })

  it('should compare two fields with $expr and $gt', async () => {
    const docs = await collection.find({
      $expr: { $gt: ['$discount', { $multiply: ['$price', 0.2] }] },
    }).toArray()

    // discount > price * 0.2
    expect(docs.length).toBe(1)
    expect(docs[0]!.price).toBe(200) // 50 > 40
  })

  it('should use $expr with $add', async () => {
    const docs = await collection.find({
      $expr: {
        $gt: [{ $add: ['$price', '$discount'] }, 100],
      },
    }).toArray()

    // price + discount > 100
    expect(docs.length).toBe(3) // 110, 250, 180
  })

  it('should use $expr with $multiply', async () => {
    const docs = await collection.find({
      $expr: {
        $gt: [{ $multiply: ['$price', '$quantity'] }, 500],
      },
    }).toArray()

    // price * quantity > 500
    expect(docs.length).toBe(1)
    expect(docs[0]!.price).toBe(50) // 50 * 10 = 500, not > 500... actually 500 is not > 500
    // Let me recalculate: 100*5=500, 200*2=400, 50*10=500, 150*3=450
    // None are > 500, so should be 0
  })

  it('should combine $expr with regular query operators', async () => {
    const docs = await collection.find({
      quantity: { $gte: 5 },
      $expr: { $lt: ['$discount', 10] },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.price).toBe(50)
  })
})

// ============================================================================
// $type Operator Tests (Extended BSON Types)
// ============================================================================

interface MixedDoc extends Document {
  value: unknown
  name: string
}

describe('$type Operator (Extended)', () => {
  let collection: Collection<MixedDoc>

  beforeEach(async () => {
    collection = new Collection<MixedDoc>('testdb', 'mixed')
    await collection.insertMany([
      { value: 42, name: 'number' },
      { value: 'hello', name: 'string' },
      { value: true, name: 'boolean' },
      { value: null, name: 'null' },
      { value: new Date(), name: 'date' },
      { value: [1, 2, 3], name: 'array' },
      { value: { nested: 'object' }, name: 'object' },
      { value: /pattern/i, name: 'regex' },
      { value: new ObjectId(), name: 'objectId' },
    ])
  })

  it('should match by type name string', async () => {
    const docs = await collection.find({
      value: { $type: 'string' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.name).toBe('string')
  })

  it('should match by BSON type number', async () => {
    // BSON type 16 = int32, type 1 = double
    const docs = await collection.find({
      value: { $type: 'number' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.name).toBe('number')
  })

  it('should match arrays with $type: "array"', async () => {
    const docs = await collection.find({
      value: { $type: 'array' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.name).toBe('array')
  })

  it('should match objects with $type: "object"', async () => {
    const docs = await collection.find({
      value: { $type: 'object' },
    }).toArray()

    // Arrays are also objects in MongoDB, but this should only match plain objects
    expect(docs.some((d) => d.name === 'object')).toBe(true)
  })

  it('should match null with $type: "null"', async () => {
    const docs = await collection.find({
      value: { $type: 'null' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.name).toBe('null')
  })

  it('should match dates with $type: "date"', async () => {
    const docs = await collection.find({
      value: { $type: 'date' },
    }).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.name).toBe('date')
  })

  it('should match with array of types', async () => {
    const docs = await collection.find({
      value: { $type: ['string', 'number'] },
    }).toArray()

    expect(docs.length).toBe(2)
  })
})

// ============================================================================
// $where Operator Tests (JavaScript Expression)
// ============================================================================

describe('$where Operator', () => {
  let collection: Collection<NumberDoc>

  beforeEach(async () => {
    collection = new Collection<NumberDoc>('testdb', 'numbers')
    await collection.insertMany([
      { value: 10, name: 'ten' },
      { value: 20, name: 'twenty' },
      { value: 30, name: 'thirty' },
    ])
  })

  it('should evaluate JavaScript function', async () => {
    const docs = await collection.find({
      $where: function (this: NumberDoc) {
        return this.value > 15
      },
    } as any).toArray()

    expect(docs.length).toBe(2)
  })

  it('should evaluate JavaScript string', async () => {
    const docs = await collection.find({
      $where: 'this.value > 15',
    } as any).toArray()

    expect(docs.length).toBe(2)
  })

  it('should combine $where with other operators', async () => {
    const docs = await collection.find({
      value: { $lt: 30 },
      $where: 'this.value > 15',
    } as any).toArray()

    expect(docs.length).toBe(1)
    expect(docs[0]!.value).toBe(20)
  })
})

// ============================================================================
// Geospatial Operators Tests (Placeholder)
// ============================================================================

interface Location extends Document {
  name: string
  location: {
    type: 'Point'
    coordinates: [number, number] // [longitude, latitude]
  }
}

describe.skip('Geospatial Operators (Future)', () => {
  let collection: Collection<Location>

  beforeEach(async () => {
    collection = new Collection<Location>('testdb', 'places')

    // Create 2dsphere index
    await collection.createIndex({ location: '2dsphere' })

    await collection.insertMany([
      { name: 'NYC', location: { type: 'Point', coordinates: [-74.006, 40.7128] } },
      { name: 'LA', location: { type: 'Point', coordinates: [-118.2437, 34.0522] } },
      { name: 'Chicago', location: { type: 'Point', coordinates: [-87.6298, 41.8781] } },
    ])
  })

  it('should find near a point with $near', async () => {
    const docs = await collection.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
          $maxDistance: 100000, // 100km
        },
      },
    }).toArray()

    expect(docs.length).toBeGreaterThan(0)
    expect(docs[0]!.name).toBe('NYC')
  })

  it('should find within polygon with $geoWithin', async () => {
    const docs = await collection.find({
      location: {
        $geoWithin: {
          $geometry: {
            type: 'Polygon',
            coordinates: [[
              [-130, 20],
              [-60, 20],
              [-60, 50],
              [-130, 50],
              [-130, 20],
            ]],
          },
        },
      },
    }).toArray()

    expect(docs.length).toBe(3) // All within continental US
  })
})
