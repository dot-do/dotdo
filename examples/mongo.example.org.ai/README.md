# mongo.example.com.ai

MongoDB-compatible document store on Cloudflare Durable Objects.

## The Problem

You know MongoDB. Your code already uses `find()`, `insertOne()`, `updateOne()`. But:

- **MongoDB Atlas** costs scale with data volume
- **Self-hosted MongoDB** requires ops, backups, replica sets
- **Neither** runs at the edge

## The Solution

`mongo.example.com.ai` speaks MongoDB query syntax, runs on Cloudflare's edge network, and stores data in dotdo's cost-optimized storage layer.

**Same API. Edge performance. No ops.**

## Quick Start

```typescript
import { MongoClient } from 'dotdo/compat/mongo'

const client = new MongoClient('mongo.example.com.ai')
const db = client.db('myapp')
const users = db.collection('users')

// Your existing MongoDB code works
await users.insertOne({ name: 'Alice', email: 'alice@example.com' })
const user = await users.findOne({ email: 'alice@example.com' })
```

## CRUD Operations

### Insert

```typescript
// Single document
const result = await users.insertOne({
  name: 'Bob',
  email: 'bob@example.com',
  createdAt: new Date()
})
console.log(result.insertedId) // auto-generated $id

// Multiple documents
const bulk = await users.insertMany([
  { name: 'Charlie', role: 'admin' },
  { name: 'Diana', role: 'user' }
])
console.log(bulk.insertedCount) // 2
```

### Find

```typescript
// Find one
const admin = await users.findOne({ role: 'admin' })

// Find many with query operators
const activeUsers = await users.find({
  lastLogin: { $gt: new Date('2024-01-01') },
  status: { $ne: 'banned' }
}).toArray()

// Projection (select fields)
const emails = await users.find({}, {
  projection: { email: 1, _id: 0 }
}).toArray()

// Sort, skip, limit
const page = await users.find({})
  .sort({ createdAt: -1 })
  .skip(20)
  .limit(10)
  .toArray()
```

### Update

```typescript
// Update one
await users.updateOne(
  { email: 'alice@example.com' },
  { $set: { lastLogin: new Date() } }
)

// Update many
await users.updateMany(
  { role: 'guest' },
  { $set: { role: 'user' } }
)

// Upsert
await users.updateOne(
  { email: 'new@example.com' },
  { $set: { name: 'New User' } },
  { upsert: true }
)
```

### Delete

```typescript
// Delete one
await users.deleteOne({ email: 'bob@example.com' })

// Delete many
await users.deleteMany({ status: 'inactive' })
```

## Query Operators

Supported MongoDB query operators:

```typescript
// Comparison
{ age: { $eq: 25 } }      // equals
{ age: { $ne: 25 } }      // not equals
{ age: { $gt: 18 } }      // greater than
{ age: { $gte: 18 } }     // greater than or equal
{ age: { $lt: 65 } }      // less than
{ age: { $lte: 65 } }     // less than or equal
{ age: { $in: [20, 25] } }   // in array
{ age: { $nin: [0, null] } } // not in array

// Logical
{ $and: [{ age: { $gte: 18 } }, { status: 'active' }] }
{ $or: [{ role: 'admin' }, { role: 'moderator' }] }
{ $not: { status: 'banned' } }

// Element
{ email: { $exists: true } }
{ age: { $type: 'number' } }

// Array
{ tags: { $all: ['javascript', 'typescript'] } }
{ scores: { $elemMatch: { $gt: 90 } } }

// String (regex)
{ name: { $regex: '^A', $options: 'i' } }
```

## Aggregation Pipeline

Aggregations use dotdo's fanout for distributed execution:

```typescript
const result = await users.aggregate([
  // Stage 1: Filter
  { $match: { status: 'active' } },

  // Stage 2: Group by role
  { $group: {
    _id: '$role',
    count: { $sum: 1 },
    avgAge: { $avg: '$age' }
  }},

  // Stage 3: Sort by count
  { $sort: { count: -1 } },

  // Stage 4: Limit results
  { $limit: 10 }
]).toArray()
```

### Supported Pipeline Stages

```typescript
{ $match: { ... } }     // Filter documents
{ $group: { ... } }     // Group and aggregate
{ $sort: { ... } }      // Sort results
{ $limit: n }           // Limit results
{ $skip: n }            // Skip results
{ $project: { ... } }   // Select/transform fields
{ $unwind: '$array' }   // Flatten arrays
{ $lookup: { ... } }    // Join collections
```

## Promise Pipelining

Promises are stubs. Chain methods without awaiting - the network call happens once at the end.

```typescript
// ❌ Sequential - N round-trips
for (const doc of docs) {
  await users.insertOne(doc)
}

// ✅ Pipelined - fire and forget (no await needed for side effects)
docs.forEach(doc => users.insertOne(doc))

// ✅ Pipelined - single round-trip for chained operations
const count = await users.find({ status: 'active' })
  .sort({ createdAt: -1 })
  .limit(100)
  .count()
```

Only `await` when you need the result. Fire-and-forget inserts, updates, and deletes are valid - dotdo's durability layer handles persistence.

## Collections as Nouns

Under the hood, MongoDB collections map to dotdo Nouns:

```typescript
// These are equivalent:
const users = db.collection('users')
const Users = noun('User')

// MongoDB document
{ _id: '123', name: 'Alice' }

// dotdo Thing
{ $id: '123', $type: 'User', name: 'Alice' }
```

## How It Works

```
MongoDB Client → Wire Protocol → dotdo Worker → Durable Object
                                      ↓
                              Query Translation
                                      ↓
                              Things Store (SQLite)
```

1. **Wire Protocol**: Speaks MongoDB protocol on port 27017
2. **Query Translation**: Converts MongoDB queries to Thing operations
3. **Storage**: Uses dotdo's 4-layer durability stack

## Deployment

```bash
# Deploy your mongo-compatible endpoint
npx wrangler deploy --name mongo-example

# Connect from anywhere
mongosh "mongodb://mongo.example.com.ai:27017/mydb"
```

## Limitations

Not yet supported:

- Transactions (multi-document)
- Change streams
- Text search indexes
- Geospatial queries
- GridFS

These are on the roadmap. For most CRUD workloads, the current implementation is complete.

## Migration Guide

```typescript
// Before: MongoDB Atlas
const client = new MongoClient('mongodb+srv://cluster.mongodb.net')

// After: dotdo
const client = new MongoClient('mongo.example.com.ai')

// Everything else stays the same
```

## Cost Comparison

| Operation | MongoDB Atlas | dotdo |
|-----------|--------------|-------|
| Storage | $0.25/GB/mo | $0.20/GB/mo |
| Reads | $0.10/million | $0.01/million |
| Writes | $0.10/million | $0.02/million |
| Network | $0.10/GB | Included |

*Costs vary by region and usage patterns.*

## Next Steps

- [Full API Reference](/docs/compat/mongo)
- [Query Operator Details](/docs/compat/mongo/operators)
- [Aggregation Pipeline](/docs/compat/mongo/aggregation)
- [Performance Tuning](/docs/compat/mongo/performance)
