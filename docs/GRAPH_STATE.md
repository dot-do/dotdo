# Graph-Based State Patterns

dotdo uses a graph model for state management where entities (Things) are connected by Relationships. This document covers graph query patterns, traversal, and comparison with traditional ORM approaches.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Creating Things](#creating-things)
- [Creating Relationships](#creating-relationships)
- [Querying the Graph](#querying-the-graph)
- [Traversal Patterns](#traversal-patterns)
- [Common Graph Patterns](#common-graph-patterns)
- [Comparison with Traditional ORMs](#comparison-with-traditional-orms)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

---

## Overview

Traditional databases force you to think in tables with foreign keys and join tables. Real applications think in relationships:

- **User** owns **Documents**
- **Order** contains **LineItems**
- **Team** includes **Members**
- **Customer** placed **Order**

dotdo's graph model makes these relationships natural. No foreign keys, no join tables - just Things and Relationships.

```typescript
// Create entities
const customer = await $.things.create({ $type: 'Customer', name: 'Alice' })
const order = await $.things.create({ $type: 'Order', total: 150 })

// Connect them with a relationship
await $.relationships.add({
  subject: customer.$id,
  predicate: 'placed',
  object: order.$id
})

// Traverse the graph
const orders = await $.relationships.getRelated(customer.$id, 'placed')
```

---

## Core Concepts

### Things

Things are the nodes in your graph. Each Thing has:

- `$id` - Unique identifier (auto-generated)
- `$type` - Entity type (e.g., 'Customer', 'Order')
- `$createdAt` - Creation timestamp
- `$updatedAt` - Last update timestamp
- Custom properties you define

```typescript
interface Thing {
  $id: string      // Auto-generated unique ID
  $type: string    // Entity type
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown  // Your custom fields
}
```

### Relationships

Relationships are edges connecting Things. They follow the subject-predicate-object pattern (like RDF triples):

- `subject` - The source Thing's $id
- `predicate` - The relationship type (verb)
- `object` - The target Thing's $id
- `$createdAt` - When the relationship was created

```typescript
interface Relationship {
  subject: string    // Source Thing $id
  predicate: string  // Relationship type (verb)
  object: string     // Target Thing $id
  $createdAt: number
}
```

### Subject-Predicate-Object Pattern

This pattern naturally expresses relationships:

| Subject | Predicate | Object |
|---------|-----------|--------|
| Customer | placed | Order |
| Order | contains | LineItem |
| User | owns | Document |
| Team | includes | Member |
| Employee | reports_to | Manager |

---

## Creating Things

### Basic Creation

```typescript
// Create a customer
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com',
  tier: 'premium'
})
// Returns: { $id: 'abc123', $type: 'Customer', name: 'Alice', ... }

// Create an order
const order = await $.things.create({
  $type: 'Order',
  total: 299.99,
  status: 'pending',
  items: ['SKU-001', 'SKU-002']
})
```

### Bulk Creation

```typescript
// Create multiple things at once
const products = await $.things.bulkCreate([
  { $type: 'Product', name: 'Widget', price: 19.99 },
  { $type: 'Product', name: 'Gadget', price: 49.99 },
  { $type: 'Product', name: 'Gizmo', price: 29.99 }
])
```

### Typed Things

```typescript
// Define your entity type
interface Customer {
  $id: string
  $type: 'Customer'
  name: string
  email: string
  tier: 'free' | 'pro' | 'enterprise'
}

// Create with type safety
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Bob',
  email: 'bob@example.com',
  tier: 'pro'
}) as Customer
```

---

## Creating Relationships

### Basic Relationship

```typescript
// Customer placed Order
await $.relationships.add({
  subject: customer.$id,
  predicate: 'placed',
  object: order.$id
})

// Order contains LineItem
await $.relationships.add({
  subject: order.$id,
  predicate: 'contains',
  object: lineItem.$id
})
```

### Bidirectional Relationships

For relationships that need to be traversed both ways, create both directions:

```typescript
// User follows User (social graph)
async function follow(followerId: string, followeeId: string) {
  // Forward: "Alice follows Bob"
  await $.relationships.add({
    subject: followerId,
    predicate: 'follows',
    object: followeeId
  })

  // Reverse: "Bob is followed by Alice"
  await $.relationships.add({
    subject: followeeId,
    predicate: 'followed_by',
    object: followerId
  })
}
```

### Relationship with Metadata

Add custom metadata to relationships:

```typescript
await $.relationships.add({
  subject: employee.$id,
  predicate: 'reports_to',
  object: manager.$id,
  // Custom metadata
  since: '2024-01-15',
  department: 'Engineering'
})
```

---

## Querying the Graph

### Get Related Objects

Find all Things related to a subject with a specific predicate:

```typescript
// Get all orders placed by a customer
const orderIds = await $.relationships.getRelated(customer.$id, 'placed')
// Returns: ['order-123', 'order-456', ...]

// Fetch the actual order Things
const orders = await Promise.all(
  orderIds.map(id => $.things.get(id))
)
```

### Get Related Subjects (Reverse)

Find all Things that relate TO an object:

```typescript
// Get all customers who placed this order (reverse lookup)
const customerIds = await $.relationships.getRelatedTo(order.$id, 'placed')
// Returns: ['customer-abc']

// Get all employees who report to this manager
const reportIds = await $.relationships.getRelatedTo(manager.$id, 'reports_to')
```

### Find Relationships by Query

Query relationships with flexible filters:

```typescript
// Find all relationships from a subject
const fromCustomer = await $.relationships.find({
  subject: customer.$id
})

// Find all relationships of a type
const allFollows = await $.relationships.find({
  predicate: 'follows'
})

// Find specific relationship
const exists = await $.relationships.find({
  subject: customer.$id,
  predicate: 'placed',
  object: order.$id
})
```

### List Things by Type

```typescript
// Get all customers
const customers = await $.things.list({ type: 'Customer' })

// With pagination
const page1 = await $.things.list({
  type: 'Order',
  limit: 20,
  offset: 0
})
```

---

## Traversal Patterns

### Single-Hop Traversal

```typescript
// Customer -> Orders
async function getCustomerOrders(customerId: string) {
  const orderIds = await $.relationships.getRelated(customerId, 'placed')
  return Promise.all(orderIds.map(id => $.things.get(id)))
}
```

### Multi-Hop Traversal

```typescript
// Customer -> Orders -> LineItems
async function getCustomerLineItems(customerId: string) {
  // First hop: Customer -> Orders
  const orderIds = await $.relationships.getRelated(customerId, 'placed')

  // Second hop: Orders -> LineItems
  const lineItemIds = await Promise.all(
    orderIds.map(orderId =>
      $.relationships.getRelated(orderId, 'contains')
    )
  )

  // Flatten and fetch
  const allLineItemIds = lineItemIds.flat()
  return Promise.all(allLineItemIds.map(id => $.things.get(id)))
}
```

### Recursive Traversal (Hierarchies)

```typescript
// Get all reports in an org hierarchy (recursive)
async function getAllReports(managerId: string): Promise<string[]> {
  const directReports = await $.relationships.getRelatedTo(managerId, 'reports_to')

  // Recursively get reports of reports
  const nestedReports = await Promise.all(
    directReports.map(id => getAllReports(id))
  )

  return [...directReports, ...nestedReports.flat()]
}
```

### Graph Pattern Matching

```typescript
// Find customers who bought a specific product
async function findCustomersWhoBought(productId: string) {
  // LineItems containing this product
  const lineItemIds = await $.relationships.getRelatedTo(productId, 'contains_product')

  // Orders containing those line items
  const orderIds = await Promise.all(
    lineItemIds.map(id => $.relationships.getRelatedTo(id, 'contains'))
  )

  // Customers who placed those orders
  const customerIds = await Promise.all(
    orderIds.flat().map(id => $.relationships.getRelatedTo(id, 'placed'))
  )

  return [...new Set(customerIds.flat())] // Deduplicate
}
```

---

## Common Graph Patterns

### E-Commerce Order Graph

```typescript
// Create entities
const customer = await $.things.create({ $type: 'Customer', name: 'Alice' })
const order = await $.things.create({ $type: 'Order', total: 150, status: 'pending' })
const product1 = await $.things.create({ $type: 'Product', name: 'Widget', price: 50 })
const product2 = await $.things.create({ $type: 'Product', name: 'Gadget', price: 100 })

// Create relationships
await $.relationships.add({ subject: customer.$id, predicate: 'placed', object: order.$id })
await $.relationships.add({ subject: order.$id, predicate: 'contains', object: product1.$id })
await $.relationships.add({ subject: order.$id, predicate: 'contains', object: product2.$id })

// Query: What products did Alice order?
async function getCustomerProducts(customerId: string) {
  const orderIds = await $.relationships.getRelated(customerId, 'placed')
  const productIdArrays = await Promise.all(
    orderIds.map(oid => $.relationships.getRelated(oid, 'contains'))
  )
  const productIds = [...new Set(productIdArrays.flat())]
  return Promise.all(productIds.map(id => $.things.get(id)))
}
```

### Social Network Graph

```typescript
// User follows User pattern
const user1 = await $.things.create({ $type: 'User', name: 'Alice' })
const user2 = await $.things.create({ $type: 'User', name: 'Bob' })
const user3 = await $.things.create({ $type: 'User', name: 'Charlie' })

// Alice follows Bob and Charlie
await $.relationships.add({ subject: user1.$id, predicate: 'follows', object: user2.$id })
await $.relationships.add({ subject: user1.$id, predicate: 'follows', object: user3.$id })

// Bob follows Charlie
await $.relationships.add({ subject: user2.$id, predicate: 'follows', object: user3.$id })

// Get followers of Charlie
const charlieFollowers = await $.relationships.getRelatedTo(user3.$id, 'follows')
// Returns: [Alice, Bob]

// Get who Alice follows
const aliceFollowing = await $.relationships.getRelated(user1.$id, 'follows')
// Returns: [Bob, Charlie]

// Find mutual follows (friends)
async function getMutualFollows(userId: string) {
  const following = await $.relationships.getRelated(userId, 'follows')
  const followers = await $.relationships.getRelatedTo(userId, 'follows')
  return following.filter(id => followers.includes(id))
}
```

### Organization Hierarchy

```typescript
// Manager -> Employee hierarchy
const ceo = await $.things.create({ $type: 'Employee', name: 'CEO', level: 0 })
const vp1 = await $.things.create({ $type: 'Employee', name: 'VP Engineering', level: 1 })
const vp2 = await $.things.create({ $type: 'Employee', name: 'VP Sales', level: 1 })
const eng1 = await $.things.create({ $type: 'Employee', name: 'Engineer 1', level: 2 })
const eng2 = await $.things.create({ $type: 'Employee', name: 'Engineer 2', level: 2 })

// Build hierarchy
await $.relationships.add({ subject: vp1.$id, predicate: 'reports_to', object: ceo.$id })
await $.relationships.add({ subject: vp2.$id, predicate: 'reports_to', object: ceo.$id })
await $.relationships.add({ subject: eng1.$id, predicate: 'reports_to', object: vp1.$id })
await $.relationships.add({ subject: eng2.$id, predicate: 'reports_to', object: vp1.$id })

// Get direct reports
async function getDirectReports(managerId: string) {
  return $.relationships.getRelatedTo(managerId, 'reports_to')
}

// Get full org under a manager
async function getOrgTree(managerId: string, depth = 0): Promise<Array<{id: string, depth: number}>> {
  const directIds = await getDirectReports(managerId)
  const direct = directIds.map(id => ({ id, depth: depth + 1 }))

  const nested = await Promise.all(
    directIds.map(id => getOrgTree(id, depth + 1))
  )

  return [...direct, ...nested.flat()]
}
```

### Content Tagging System

```typescript
// Article tagged with Topics
const article = await $.things.create({
  $type: 'Article',
  title: 'Building with dotdo',
  body: '...'
})
const tag1 = await $.things.create({ $type: 'Tag', name: 'javascript' })
const tag2 = await $.things.create({ $type: 'Tag', name: 'durable-objects' })
const tag3 = await $.things.create({ $type: 'Tag', name: 'cloudflare' })

// Tag the article
await $.relationships.add({ subject: article.$id, predicate: 'tagged', object: tag1.$id })
await $.relationships.add({ subject: article.$id, predicate: 'tagged', object: tag2.$id })
await $.relationships.add({ subject: article.$id, predicate: 'tagged', object: tag3.$id })

// Find articles with a specific tag
async function getArticlesByTag(tagId: string) {
  const articleIds = await $.relationships.getRelatedTo(tagId, 'tagged')
  return Promise.all(articleIds.map(id => $.things.get(id)))
}

// Find related articles (share tags)
async function getRelatedArticles(articleId: string) {
  const tagIds = await $.relationships.getRelated(articleId, 'tagged')
  const relatedIdArrays = await Promise.all(
    tagIds.map(tid => $.relationships.getRelatedTo(tid, 'tagged'))
  )
  const relatedIds = [...new Set(relatedIdArrays.flat())]
  return relatedIds.filter(id => id !== articleId)
}
```

---

## Comparison with Traditional ORMs

### Foreign Keys vs Relationships

**Traditional ORM (SQL):**

```typescript
// Define tables with foreign keys
interface Order {
  id: string
  customer_id: string  // Foreign key
  total: number
}

interface Customer {
  id: string
  name: string
}

// Query with JOIN
const result = await db.query(`
  SELECT orders.*, customers.name
  FROM orders
  JOIN customers ON orders.customer_id = customers.id
  WHERE customers.id = ?
`, [customerId])
```

**dotdo Graph Model:**

```typescript
// Create things (no foreign keys)
const customer = await $.things.create({ $type: 'Customer', name: 'Alice' })
const order = await $.things.create({ $type: 'Order', total: 150 })

// Create explicit relationship
await $.relationships.add({
  subject: customer.$id,
  predicate: 'placed',
  object: order.$id
})

// Query via traversal
const orderIds = await $.relationships.getRelated(customer.$id, 'placed')
const orders = await Promise.all(orderIds.map(id => $.things.get(id)))
```

### Join Tables vs Relationships

**Traditional ORM (Many-to-Many):**

```typescript
// Need a join table
interface StudentCourse {
  student_id: string
  course_id: string
  enrolled_at: Date
}

// Query requires JOINs
const courses = await db.query(`
  SELECT courses.* FROM courses
  JOIN student_courses ON courses.id = student_courses.course_id
  WHERE student_courses.student_id = ?
`, [studentId])
```

**dotdo Graph Model:**

```typescript
// Direct relationships (no join table)
await $.relationships.add({
  subject: student.$id,
  predicate: 'enrolled_in',
  object: course.$id,
  enrolled_at: Date.now()  // Metadata on relationship
})

// Simple query
const courseIds = await $.relationships.getRelated(student.$id, 'enrolled_in')
const courses = await Promise.all(courseIds.map(id => $.things.get(id)))
```

### Schema Changes

**Traditional ORM:**

```typescript
// Adding a new relationship type requires migration
// 1. Create migration file
// 2. Add new foreign key column or join table
// 3. Update model definitions
// 4. Run migration
```

**dotdo Graph Model:**

```typescript
// Just add the relationship - no migration needed!
await $.relationships.add({
  subject: user.$id,
  predicate: 'mentored_by',  // New relationship type
  object: mentor.$id
})
```

### Advantages of Graph Model

| Aspect | Traditional ORM | dotdo Graph |
|--------|-----------------|-------------|
| Schema changes | Requires migrations | Schema-free |
| Many-to-many | Join tables needed | Direct relationships |
| Relationship metadata | Complex modeling | First-class support |
| Traversal queries | Complex JOINs | Simple API |
| Flexibility | Rigid structure | Highly flexible |
| Data model | Table-centric | Entity-centric |

---

## Best Practices

### 1. Use Consistent Predicates

Define a vocabulary of predicates and stick to it:

```typescript
// Good - consistent naming
const PREDICATES = {
  PLACED: 'placed',        // Customer placed Order
  CONTAINS: 'contains',    // Order contains LineItem
  OWNS: 'owns',            // User owns Document
  FOLLOWS: 'follows',      // User follows User
  TAGGED: 'tagged',        // Article tagged Tag
  REPORTS_TO: 'reports_to' // Employee reports_to Manager
} as const
```

### 2. Index Common Queries

If you frequently query by type, the `list` method is optimized:

```typescript
// Efficient - uses internal indexing
const customers = await $.things.list({ type: 'Customer' })

// For relationship queries, consider caching hot paths
```

### 3. Use Batching for Bulk Operations

```typescript
// Good - single batch operation
const items = await $.things.bulkCreate([
  { $type: 'Item', name: 'A' },
  { $type: 'Item', name: 'B' },
  { $type: 'Item', name: 'C' }
])

// Avoid - multiple individual creates
for (const name of ['A', 'B', 'C']) {
  await $.things.create({ $type: 'Item', name })
}
```

### 4. Handle Missing Relationships Gracefully

```typescript
async function getCustomerOrders(customerId: string) {
  const customer = await $.things.get(customerId)
  if (!customer) {
    return { customer: null, orders: [] }
  }

  const orderIds = await $.relationships.getRelated(customerId, 'placed')
  const orders = await Promise.all(
    orderIds.map(async id => {
      const order = await $.things.get(id)
      return order // May be null if deleted
    })
  )

  return {
    customer,
    orders: orders.filter(Boolean) // Filter out nulls
  }
}
```

### 5. Use Meaningful Type Names

```typescript
// Good - clear entity types
const customer = await $.things.create({ $type: 'Customer', ... })
const order = await $.things.create({ $type: 'Order', ... })
const lineItem = await $.things.create({ $type: 'OrderLineItem', ... })

// Avoid - generic types
const thing1 = await $.things.create({ $type: 'Entity', ... })
const thing2 = await $.things.create({ $type: 'Item', ... })
```

---

## API Reference

### ThingsStore

```typescript
interface ThingsStore {
  // Create a new Thing
  create(data: { $type: string; [key: string]: unknown }): Promise<Thing>

  // Get a Thing by ID
  get(id: string): Promise<Thing | null>

  // Update a Thing
  update(id: string, data: Partial<Thing>): Promise<Thing>

  // Delete a Thing
  delete(id: string): Promise<void>

  // List Things with optional filters
  list(options?: { type?: string; limit?: number; offset?: number }): Promise<Thing[]>

  // Bulk operations
  bulkCreate(items: Array<{ $type: string; [key: string]: unknown }>): Promise<Thing[]>
  bulkUpdate(items: Array<{ id: string; data: Partial<Thing> }>): Promise<Thing[]>
  bulkDelete(ids: string[]): Promise<void>
}
```

### RelationshipsStore

```typescript
interface RelationshipsStore {
  // Add a new relationship
  add(rel: {
    subject: string
    predicate: string
    object: string
    [key: string]: unknown  // Optional metadata
  }): Promise<Relationship>

  // Remove a relationship
  remove(rel: {
    subject: string
    predicate: string
    object: string
  }): Promise<void>

  // Find relationships by query
  find(query: {
    subject?: string
    predicate?: string
    object?: string
  }): Promise<Relationship[]>

  // Get objects related to a subject
  getRelated(subjectId: string, predicate: string): Promise<string[]>

  // Get subjects that relate to an object (reverse)
  getRelatedTo(objectId: string, predicate: string): Promise<string[]>
}
```

---

## Related Documentation

- [Getting Started](./GETTING_STARTED.md) - Basic dotdo setup
- [README](../README.md) - Full project overview
- [API Reference](./SDK_GENERATION.md) - SDK generation from resources
