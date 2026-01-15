/**
 * Semantic Type System (DOSemantic) - RED Phase Tests
 *
 * This file contains failing tests for the semantic type system.
 * The semantic layer provides:
 * - Nouns: Entity type definitions with auto-derived singular/plural forms
 * - Verbs: Action definitions with auto-derived tenses
 * - Things: Entity instances with $id and $type
 * - Actions: Unified event + edge + audit records
 * - Relationship operators: ->, ~>, <-, <~ for traversal
 *
 * @module semantic/semantic.test
 * @see do-v2.2.1 [RED] Semantic Type System tests
 */

import { describe, it, expect, expectTypeOf } from 'vitest'

// These imports will fail until DOSemantic is implemented
import {
  // Noun definitions
  noun,
  getNoun,
  getAllNouns,
  type Noun,
  type NounRegistry,

  // Verb definitions
  verb,
  getVerb,
  getAllVerbs,
  type Verb,
  type VerbRegistry,

  // Thing instances
  thing,
  type Thing,

  // Actions (unified event + edge + audit)
  action,
  type Action,
  type ActionResult,

  // Relationship operators
  type RelationshipOperator,
  forward,
  backward,
  forwardFuzzy,
  backwardFuzzy,
} from './index'

// ============================================================================
// 1. NOUN DEFINITIONS
// ============================================================================

describe('Noun Definitions', () => {
  describe('Auto-derived singular/plural forms', () => {
    it('should derive regular plural by adding "s"', () => {
      const Customer = noun('Customer')

      expect(Customer.singular).toBe('Customer')
      expect(Customer.plural).toBe('Customers')
    })

    it('should derive plural ending in "es" for nouns ending in s, x, z, ch, sh', () => {
      const Business = noun('Business')
      expect(Business.plural).toBe('Businesses')

      const Box = noun('Box')
      expect(Box.plural).toBe('Boxes')

      const Buzz = noun('Buzz')
      expect(Buzz.plural).toBe('Buzzes')

      const Match = noun('Match')
      expect(Match.plural).toBe('Matches')

      const Wish = noun('Wish')
      expect(Wish.plural).toBe('Wishes')
    })

    it('should derive plural by changing "y" to "ies" for consonant+y', () => {
      const Company = noun('Company')
      expect(Company.plural).toBe('Companies')

      const Category = noun('Category')
      expect(Category.plural).toBe('Categories')
    })

    it('should derive plural by adding "s" for vowel+y', () => {
      const Key = noun('Key')
      expect(Key.plural).toBe('Keys')

      const Day = noun('Day')
      expect(Day.plural).toBe('Days')
    })

    it('should handle irregular plurals with explicit override', () => {
      const Person = noun('Person', { plural: 'People' })
      expect(Person.singular).toBe('Person')
      expect(Person.plural).toBe('People')

      const Child = noun('Child', { plural: 'Children' })
      expect(Child.plural).toBe('Children')

      const Mouse = noun('Mouse', { plural: 'Mice' })
      expect(Mouse.plural).toBe('Mice')
    })

    it('should handle uncountable nouns (same singular/plural)', () => {
      const Equipment = noun('Equipment', { plural: 'Equipment' })
      expect(Equipment.singular).toBe('Equipment')
      expect(Equipment.plural).toBe('Equipment')

      const Information = noun('Information', { plural: 'Information' })
      expect(Information.plural).toBe('Information')
    })
  })

  describe('Noun registry', () => {
    it('should register nouns and retrieve by name', () => {
      const Customer = noun('Customer')

      const retrieved = getNoun('Customer')
      expect(retrieved).toBe(Customer)
    })

    it('should return undefined for unregistered nouns', () => {
      const result = getNoun('NonExistentNoun')
      expect(result).toBeUndefined()
    })

    it('should list all registered nouns', () => {
      noun('Alpha')
      noun('Beta')
      noun('Gamma')

      const allNouns = getAllNouns()
      expect(allNouns).toContainEqual(expect.objectContaining({ singular: 'Alpha' }))
      expect(allNouns).toContainEqual(expect.objectContaining({ singular: 'Beta' }))
      expect(allNouns).toContainEqual(expect.objectContaining({ singular: 'Gamma' }))
    })

    it('should not allow duplicate noun registration', () => {
      noun('Unique')
      expect(() => noun('Unique')).toThrow(/already registered/)
    })
  })

  describe('Noun type safety', () => {
    it('should have correct TypeScript types', () => {
      const Customer = noun('Customer')

      expectTypeOf(Customer).toMatchTypeOf<Noun>()
      expectTypeOf(Customer.singular).toBeString()
      expectTypeOf(Customer.plural).toBeString()
    })

    it('NounRegistry should be a map of string to Noun', () => {
      expectTypeOf<NounRegistry>().toMatchTypeOf<Map<string, Noun>>()
    })
  })
})

// ============================================================================
// 2. VERB DEFINITIONS
// ============================================================================

describe('Verb Definitions', () => {
  describe('Auto-derived tenses', () => {
    it('should derive past tense by adding "ed" for regular verbs', () => {
      const Create = verb('create')

      expect(Create.base).toBe('create')
      expect(Create.past).toBe('created')
      expect(Create.present).toBe('creates')
      expect(Create.gerund).toBe('creating')
    })

    it('should derive past tense for verbs ending in "e"', () => {
      const Purchase = verb('purchase')

      expect(Purchase.base).toBe('purchase')
      expect(Purchase.past).toBe('purchased')
      expect(Purchase.present).toBe('purchases')
      expect(Purchase.gerund).toBe('purchasing')
    })

    it('should derive past tense for verbs ending in consonant+y', () => {
      const Apply = verb('apply')

      expect(Apply.base).toBe('apply')
      expect(Apply.past).toBe('applied')
      expect(Apply.present).toBe('applies')
      expect(Apply.gerund).toBe('applying')
    })

    it('should double final consonant for CVC pattern verbs', () => {
      const Ship = verb('ship')

      expect(Ship.past).toBe('shipped')
      expect(Ship.gerund).toBe('shipping')

      const Stop = verb('stop')
      expect(Stop.past).toBe('stopped')
      expect(Stop.gerund).toBe('stopping')
    })

    it('should handle irregular verbs with explicit overrides', () => {
      const Buy = verb('buy', { past: 'bought' })

      expect(Buy.base).toBe('buy')
      expect(Buy.past).toBe('bought')
      expect(Buy.present).toBe('buys')
      expect(Buy.gerund).toBe('buying')

      const Send = verb('send', { past: 'sent' })
      expect(Send.past).toBe('sent')

      const Go = verb('go', { past: 'went', gerund: 'going' })
      expect(Go.past).toBe('went')
      expect(Go.gerund).toBe('going')
    })

    it('should derive third person singular (present) correctly', () => {
      const Watch = verb('watch')
      expect(Watch.present).toBe('watches')

      const Pass = verb('pass')
      expect(Pass.present).toBe('passes')

      const Try = verb('try')
      expect(Try.present).toBe('tries')

      const Play = verb('play')
      expect(Play.present).toBe('plays')
    })
  })

  describe('Verb registry', () => {
    it('should register verbs and retrieve by name', () => {
      const Create = verb('create')

      const retrieved = getVerb('create')
      expect(retrieved).toBe(Create)
    })

    it('should return undefined for unregistered verbs', () => {
      const result = getVerb('nonexistentverb')
      expect(result).toBeUndefined()
    })

    it('should list all registered verbs', () => {
      verb('alpha')
      verb('beta')
      verb('gamma')

      const allVerbs = getAllVerbs()
      expect(allVerbs).toContainEqual(expect.objectContaining({ base: 'alpha' }))
      expect(allVerbs).toContainEqual(expect.objectContaining({ base: 'beta' }))
      expect(allVerbs).toContainEqual(expect.objectContaining({ base: 'gamma' }))
    })
  })

  describe('Verb type safety', () => {
    it('should have correct TypeScript types', () => {
      const Create = verb('create')

      expectTypeOf(Create).toMatchTypeOf<Verb>()
      expectTypeOf(Create.base).toBeString()
      expectTypeOf(Create.past).toBeString()
      expectTypeOf(Create.present).toBeString()
      expectTypeOf(Create.gerund).toBeString()
    })

    it('VerbRegistry should be a map of string to Verb', () => {
      expectTypeOf<VerbRegistry>().toMatchTypeOf<Map<string, Verb>>()
    })
  })
})

// ============================================================================
// 3. THING INSTANCES
// ============================================================================

describe('Thing Instances', () => {
  describe('Creation with $id and $type', () => {
    it('should create a thing with auto-generated $id', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, { name: 'Alice' })

      expect(alice.$id).toBeDefined()
      expect(typeof alice.$id).toBe('string')
      expect(alice.$type).toBe('Customer')
      expect(alice.name).toBe('Alice')
    })

    it('should create a thing with explicit $id', () => {
      const Customer = noun('Customer')
      const bob = thing(Customer, 'bob-123', { name: 'Bob' })

      expect(bob.$id).toBe('bob-123')
      expect(bob.$type).toBe('Customer')
      expect(bob.name).toBe('Bob')
    })

    it('should create thing using the pattern: thing(Noun, id)', () => {
      const Customer = noun('Customer')
      const ref = thing(Customer, 'abc')

      expect(ref.$id).toBe('abc')
      expect(ref.$type).toBe('Customer')
    })

    it('should create thing with nested data properties', () => {
      const Order = noun('Order')
      const order = thing(Order, {
        items: [
          { sku: 'SKU-001', quantity: 2 },
          { sku: 'SKU-002', quantity: 1 },
        ],
        shipping: {
          address: '123 Main St',
          city: 'San Francisco',
        },
        total: 99.99,
      })

      expect(order.$type).toBe('Order')
      expect(order.items).toHaveLength(2)
      expect(order.shipping.city).toBe('San Francisco')
      expect(order.total).toBe(99.99)
    })
  })

  describe('Thing type safety', () => {
    it('should have correct TypeScript types', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, { name: 'Alice' })

      expectTypeOf(alice).toMatchTypeOf<Thing>()
      expectTypeOf(alice.$id).toBeString()
      expectTypeOf(alice.$type).toBeString()
    })

    it('should preserve data property types', () => {
      interface CustomerData {
        name: string
        age: number
        active: boolean
      }

      const Customer = noun('Customer')
      const alice = thing<CustomerData>(Customer, {
        name: 'Alice',
        age: 30,
        active: true,
      })

      expectTypeOf(alice.name).toBeString()
      expectTypeOf(alice.age).toBeNumber()
      expectTypeOf(alice.active).toBeBoolean()
    })
  })

  describe('Thing identity', () => {
    it('should generate unique $ids for different things', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, { name: 'Alice' })
      const bob = thing(Customer, { name: 'Bob' })

      expect(alice.$id).not.toBe(bob.$id)
    })

    it('should maintain same $id for thing reference', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, 'alice-id', { name: 'Alice' })
      const aliceRef = thing(Customer, 'alice-id')

      expect(alice.$id).toBe(aliceRef.$id)
    })
  })
})

// ============================================================================
// 4. ACTIONS (UNIFIED EVENT + EDGE + AUDIT)
// ============================================================================

describe('Actions (Unified Event + Edge + Audit)', () => {
  describe('Subject.verb(object) pattern', () => {
    it('should create an action from subject.verb(object)', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook)

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
    })

    it('should create an Event record with correct structure', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook)

      expect(result.event).toMatchObject({
        type: 'purchased',
        subject: 'alice',
        object: 'macbook',
      })
      expect(result.event.timestamp).toBeInstanceOf(Date)
    })

    it('should create an Edge (relationship) from subject to object', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook)

      expect(result.edge).toMatchObject({
        from: 'alice',
        to: 'macbook',
        verb: 'purchased',
      })
    })

    it('should create an Audit record with actor information', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook)

      expect(result.audit).toMatchObject({
        actor: 'alice',
        verb: 'purchased',
        target: 'macbook',
      })
      expect(result.audit.timestamp).toBeInstanceOf(Date)
    })
  })

  describe('Action with metadata', () => {
    it('should support action metadata/context', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook, {
        price: 2499.99,
        currency: 'USD',
        paymentMethod: 'credit_card',
      })

      expect(result.event.metadata).toMatchObject({
        price: 2499.99,
        currency: 'USD',
        paymentMethod: 'credit_card',
      })
    })

    it('should support action without object (intransitive verb)', () => {
      const Customer = noun('Customer')
      const Arrive = verb('arrive')

      const alice = thing(Customer, 'alice', { name: 'Alice' })

      const result = action(alice, Arrive)

      expect(result.event).toMatchObject({
        type: 'arrived',
        subject: 'alice',
      })
      expect(result.event.object).toBeUndefined()
    })
  })

  describe('Action type safety', () => {
    it('should have correct TypeScript types', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })

      const result = action(alice, Purchase, macbook)

      expectTypeOf(result).toMatchTypeOf<ActionResult>()
      expectTypeOf(result.event).toMatchTypeOf<Action['event']>()
      expectTypeOf(result.edge).toMatchTypeOf<Action['edge']>()
      expectTypeOf(result.audit).toMatchTypeOf<Action['audit']>()
    })
  })

  describe('Action immutability', () => {
    it('should not modify the subject thing', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })
      const originalAlice = { ...alice }

      action(alice, Purchase, macbook)

      expect(alice).toEqual(originalAlice)
    })

    it('should not modify the object thing', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook Pro' })
      const originalMacbook = { ...macbook }

      action(alice, Purchase, macbook)

      expect(macbook).toEqual(originalMacbook)
    })
  })
})

// ============================================================================
// 5. FOUR RELATIONSHIP OPERATORS
// ============================================================================

describe('Relationship Operators', () => {
  describe('Forward exact: thing -> "Type"', () => {
    it('should traverse forward exact relationships', () => {
      const Customer = noun('Customer')
      const Order = noun('Order')
      const Place = verb('place')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const order1 = thing(Order, 'order-1', { total: 100 })

      // Create relationship
      action(alice, Place, order1)

      // Traverse forward
      const orders = forward(alice, 'Order')

      expect(orders).toHaveLength(1)
      expect(orders[0].$id).toBe('order-1')
    })

    it('should return empty array when no forward relationships exist', () => {
      const Customer = noun('Customer')

      const alice = thing(Customer, 'alice', { name: 'Alice' })

      const orders = forward(alice, 'Order')

      expect(orders).toEqual([])
    })

    it('should filter by target type', () => {
      const Customer = noun('Customer')
      const Order = noun('Order')
      const Product = noun('Product')
      const Place = verb('place')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const order1 = thing(Order, 'order-1', { total: 100 })
      const macbook = thing(Product, 'macbook', { name: 'MacBook' })

      action(alice, Place, order1)
      action(alice, Purchase, macbook)

      const onlyOrders = forward(alice, 'Order')
      const onlyProducts = forward(alice, 'Product')

      expect(onlyOrders).toHaveLength(1)
      expect(onlyOrders[0].$type).toBe('Order')
      expect(onlyProducts).toHaveLength(1)
      expect(onlyProducts[0].$type).toBe('Product')
    })
  })

  describe('Forward fuzzy: thing ~> "Type" (semantic/AI search)', () => {
    it('should traverse forward fuzzy relationships', async () => {
      const Document = noun('Document')
      const Topic = noun('Topic')
      const Relate = verb('relate')

      const doc = thing(Document, 'doc-1', {
        title: 'Machine Learning Basics',
        content: 'Introduction to neural networks and deep learning...',
      })
      const mlTopic = thing(Topic, 'ml', { name: 'Machine Learning' })

      action(doc, Relate, mlTopic)

      // Fuzzy search should find semantically related things
      const related = await forwardFuzzy(doc, 'Topic')

      expect(related).toHaveLength(1)
      expect(related[0].$id).toBe('ml')
    })

    it('should return similarity scores with fuzzy results', async () => {
      const Document = noun('Document')
      const Topic = noun('Topic')

      const doc = thing(Document, 'doc-1', {
        title: 'Deep Learning',
        content: 'Neural networks...',
      })

      const results = await forwardFuzzy(doc, 'Topic', { withScores: true })

      if (results.length > 0) {
        expect(results[0]).toHaveProperty('score')
        expect(typeof results[0].score).toBe('number')
        expect(results[0].score).toBeGreaterThanOrEqual(0)
        expect(results[0].score).toBeLessThanOrEqual(1)
      }
    })

    it('should support similarity threshold', async () => {
      const Document = noun('Document')
      const Topic = noun('Topic')

      const doc = thing(Document, 'doc-1', {
        title: 'Python Programming',
        content: 'Learn Python basics...',
      })

      // High threshold - only very similar matches
      const strictResults = await forwardFuzzy(doc, 'Topic', { threshold: 0.9 })

      // Low threshold - more matches allowed
      const looseResults = await forwardFuzzy(doc, 'Topic', { threshold: 0.5 })

      expect(looseResults.length).toBeGreaterThanOrEqual(strictResults.length)
    })
  })

  describe('Backward exact: thing <- "Type" (reverse lookup)', () => {
    it('should traverse backward exact relationships', () => {
      const Customer = noun('Customer')
      const Order = noun('Order')
      const Place = verb('place')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const order1 = thing(Order, 'order-1', { total: 100 })

      // Create relationship: alice -> order1
      action(alice, Place, order1)

      // Traverse backward from order to customer
      const customers = backward(order1, 'Customer')

      expect(customers).toHaveLength(1)
      expect(customers[0].$id).toBe('alice')
    })

    it('should return empty array when no backward relationships exist', () => {
      const Order = noun('Order')

      const order1 = thing(Order, 'order-1', { total: 100 })

      const customers = backward(order1, 'Customer')

      expect(customers).toEqual([])
    })

    it('should find all things pointing to target', () => {
      const Customer = noun('Customer')
      const Product = noun('Product')
      const Purchase = verb('purchase')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const bob = thing(Customer, 'bob', { name: 'Bob' })
      const macbook = thing(Product, 'macbook', { name: 'MacBook' })

      // Both customers purchased the same product
      action(alice, Purchase, macbook)
      action(bob, Purchase, macbook)

      const purchasers = backward(macbook, 'Customer')

      expect(purchasers).toHaveLength(2)
      expect(purchasers.map((p) => p.$id)).toContain('alice')
      expect(purchasers.map((p) => p.$id)).toContain('bob')
    })
  })

  describe('Backward fuzzy: thing <~ "Type" (semantic reverse)', () => {
    it('should traverse backward fuzzy relationships', async () => {
      const Article = noun('Article')
      const Author = noun('Author')
      const Write = verb('write')

      const article = thing(Article, 'art-1', {
        title: 'Introduction to AI',
        content: 'Artificial intelligence...',
      })
      const author = thing(Author, 'auth-1', {
        name: 'Dr. Smith',
        expertise: 'Machine Learning',
      })

      action(author, Write, article)

      // Find semantically related authors for the article
      const relatedAuthors = await backwardFuzzy(article, 'Author')

      expect(relatedAuthors).toHaveLength(1)
      expect(relatedAuthors[0].$id).toBe('auth-1')
    })

    it('should support similarity threshold for backward fuzzy', async () => {
      const Article = noun('Article')
      const Author = noun('Author')

      const article = thing(Article, 'art-1', {
        title: 'Quantum Computing',
        content: 'Quantum mechanics in computing...',
      })

      const strictResults = await backwardFuzzy(article, 'Author', { threshold: 0.9 })
      const looseResults = await backwardFuzzy(article, 'Author', { threshold: 0.3 })

      expect(looseResults.length).toBeGreaterThanOrEqual(strictResults.length)
    })
  })

  describe('Operator type definitions', () => {
    it('should have correct RelationshipOperator type', () => {
      expectTypeOf<RelationshipOperator>().toMatchTypeOf<'->' | '~>' | '<-' | '<~'>()
    })

    it('forward should return Thing[]', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, 'alice', { name: 'Alice' })

      const result = forward(alice, 'Order')
      expectTypeOf(result).toMatchTypeOf<Thing[]>()
    })

    it('forwardFuzzy should return Promise<Thing[]>', () => {
      const Customer = noun('Customer')
      const alice = thing(Customer, 'alice', { name: 'Alice' })

      const result = forwardFuzzy(alice, 'Order')
      expectTypeOf(result).toMatchTypeOf<Promise<Thing[]>>()
    })

    it('backward should return Thing[]', () => {
      const Order = noun('Order')
      const order = thing(Order, 'order-1', { total: 100 })

      const result = backward(order, 'Customer')
      expectTypeOf(result).toMatchTypeOf<Thing[]>()
    })

    it('backwardFuzzy should return Promise<Thing[]>', () => {
      const Order = noun('Order')
      const order = thing(Order, 'order-1', { total: 100 })

      const result = backwardFuzzy(order, 'Customer')
      expectTypeOf(result).toMatchTypeOf<Promise<Thing[]>>()
    })
  })

  describe('Chained traversals', () => {
    it('should support chaining forward traversals', () => {
      const Customer = noun('Customer')
      const Order = noun('Order')
      const Product = noun('Product')
      const Place = verb('place')
      const Contain = verb('contain')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const order1 = thing(Order, 'order-1', { total: 100 })
      const macbook = thing(Product, 'macbook', { name: 'MacBook' })

      action(alice, Place, order1)
      action(order1, Contain, macbook)

      // Chain: alice -> Order -> Product
      const orders = forward(alice, 'Order')
      const products = orders.flatMap((order) => forward(order, 'Product'))

      expect(products).toHaveLength(1)
      expect(products[0].$id).toBe('macbook')
    })

    it('should support mixed forward/backward traversals', () => {
      const Customer = noun('Customer')
      const Order = noun('Order')
      const Place = verb('place')

      const alice = thing(Customer, 'alice', { name: 'Alice' })
      const bob = thing(Customer, 'bob', { name: 'Bob' })
      const order1 = thing(Order, 'order-1', { total: 100 })

      action(alice, Place, order1)
      action(bob, Place, order1) // Shared order

      // Find other customers who placed the same order as alice
      const aliceOrders = forward(alice, 'Order')
      const otherCustomers = aliceOrders
        .flatMap((order) => backward(order, 'Customer'))
        .filter((c) => c.$id !== 'alice')

      expect(otherCustomers).toHaveLength(1)
      expect(otherCustomers[0].$id).toBe('bob')
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration: Full Semantic Workflow', () => {
  it('should support complete domain modeling workflow', () => {
    // 1. Define domain nouns
    const Customer = noun('Customer')
    const Product = noun('Product')
    const Order = noun('Order')

    // 2. Define domain verbs
    const Place = verb('place')
    const Contain = verb('contain')

    // 3. Create thing instances
    const alice = thing(Customer, 'alice', { name: 'Alice', email: 'alice@example.com' })
    const macbook = thing(Product, 'macbook', { name: 'MacBook Pro', price: 2499 })
    const order = thing(Order, 'order-1', { status: 'pending' })

    // 4. Create actions (events + edges + audit)
    const placeResult = action(alice, Place, order)
    const containResult = action(order, Contain, macbook)

    // 5. Verify events were created
    expect(placeResult.event.type).toBe('placed')
    expect(containResult.event.type).toBe('contained')

    // 6. Traverse relationships
    const aliceOrders = forward(alice, 'Order')
    expect(aliceOrders).toHaveLength(1)

    const orderProducts = forward(aliceOrders[0], 'Product')
    expect(orderProducts).toHaveLength(1)
    expect(orderProducts[0].$id).toBe('macbook')

    // 7. Reverse lookup
    const productOrders = backward(macbook, 'Order')
    expect(productOrders).toHaveLength(1)
    expect(productOrders[0].$id).toBe('order-1')
  })
})
