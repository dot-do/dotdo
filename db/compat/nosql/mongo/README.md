# mongo.do

**MongoDB for Cloudflare Workers.** Full driver API. Edge-native. Infinite scale.

[![npm version](https://img.shields.io/npm/v/@dotdo/mongo.svg)](https://www.npmjs.com/package/@dotdo/mongo)
[![Tests](https://img.shields.io/badge/tests-1%2C500%2B%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why mongo.do?

**You know MongoDB.** Your team knows MongoDB. Your codebase has years of Mongoose models and aggregation pipelines.

**mongo.do lets you keep that code.** Drop-in replacement for the MongoDB Node.js driver that runs on Cloudflare Workers. No connection pooling. No cold starts. No Atlas required.

**Scales to millions of agents.** Each agent gets isolated document storage backed by Durable Objects. Global edge deployment. Instant reads. Durable writes.

```typescript
import { createClient, ObjectId } from '@dotdo/mongo'

const client = createClient('mongodb://localhost:27017', {
  doNamespace: env.MONGO,
})

const db = client.db('myapp')
const users = db.collection('users')

// Same API you already know
await users.insertOne({ name: 'Alice', email: 'alice@example.com' })
const user = await users.findOne({ email: 'alice@example.com' })
await users.updateOne({ _id: user._id }, { $set: { verified: true } })
```

## Installation

```bash
npm install @dotdo/mongo
```

## Quick Start

```typescript
import { createClient, ObjectId } from '@dotdo/mongo'

// Connect (no actual network connection - it's all local)
const client = createClient('mongodb://localhost:27017')
await client.connect()

// Get database and collection
const db = client.db('myapp')
const users = db.collection('users')

// Insert documents
const result = await users.insertOne({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30
})
console.log(result.insertedId) // ObjectId

// Query with full operator support
const adults = await users.find({ age: { $gte: 18 } }).toArray()
const nycUsers = await users.find({
  $and: [
    { city: 'NYC' },
    { age: { $gte: 21, $lte: 35 } }
  ]
}).toArray()
```

## Features

### Complete CRUD Operations

Every method from the MongoDB driver works exactly as expected.

```typescript
// Insert
await collection.insertOne({ name: 'Alice' })
await collection.insertMany([{ name: 'Bob' }, { name: 'Charlie' }])

// Find
const doc = await collection.findOne({ name: 'Alice' })
const docs = await collection.find({ age: { $gt: 21 } }).toArray()

// Update
await collection.updateOne({ name: 'Alice' }, { $set: { age: 31 } })
await collection.updateMany({ status: 'pending' }, { $set: { status: 'active' } })
await collection.replaceOne({ name: 'Alice' }, { name: 'Alice', role: 'admin' })

// Delete
await collection.deleteOne({ name: 'Alice' })
await collection.deleteMany({ status: 'inactive' })

// Find and modify (atomic)
const old = await collection.findOneAndUpdate(
  { name: 'Alice' },
  { $inc: { loginCount: 1 } },
  { returnDocument: 'after' }
)
```

### Full Query Operators

All comparison, logical, element, and array operators are supported.

```typescript
// Comparison
{ age: { $eq: 30 } }
{ age: { $ne: 30 } }
{ age: { $gt: 18 } }
{ age: { $gte: 18 } }
{ age: { $lt: 65 } }
{ age: { $lte: 65 } }
{ status: { $in: ['active', 'pending'] } }
{ status: { $nin: ['banned', 'deleted'] } }

// Logical
{ $and: [{ age: { $gte: 18 } }, { verified: true }] }
{ $or: [{ role: 'admin' }, { role: 'moderator' }] }
{ $nor: [{ banned: true }, { deleted: true }] }
{ age: { $not: { $lt: 18 } } }

// Element
{ email: { $exists: true } }
{ score: { $type: 'number' } }

// Evaluation
{ name: { $regex: '^A', $options: 'i' } }

// Array
{ tags: { $all: ['mongodb', 'nosql'] } }
{ scores: { $elemMatch: { $gt: 80, $lt: 90 } } }
{ tags: { $size: 3 } }
```

### Update Operators

Powerful field and array updates.

```typescript
// Field updates
{ $set: { name: 'Alice' } }
{ $unset: { temporaryField: '' } }
{ $inc: { views: 1 } }
{ $mul: { price: 1.1 } }
{ $min: { lowestScore: 50 } }
{ $max: { highestScore: 100 } }
{ $rename: { oldName: 'newName' } }

// Array updates
{ $push: { tags: 'new-tag' } }
{ $push: { tags: { $each: ['a', 'b'], $position: 0 } } }
{ $pull: { tags: 'old-tag' } }
{ $addToSet: { tags: 'unique-tag' } }
{ $pop: { queue: 1 } }   // Remove last
{ $pop: { queue: -1 } }  // Remove first
```

### Aggregation Pipeline

Full pipeline support with all common stages.

```typescript
const results = await collection.aggregate([
  { $match: { status: 'active' } },
  { $group: {
      _id: '$category',
      total: { $sum: '$amount' },
      avg: { $avg: '$amount' },
      count: { $sum: 1 }
  }},
  { $sort: { total: -1 } },
  { $limit: 10 },
  { $project: {
      category: '$_id',
      total: 1,
      avg: { $round: ['$avg', 2] }
  }}
]).toArray()
```

**Supported Stages:**
- `$match` - Filter documents
- `$group` - Group by field with accumulators ($sum, $avg, $min, $max, $first, $last, $push, $addToSet)
- `$sort` - Sort results
- `$limit` - Limit output
- `$skip` - Skip documents
- `$project` - Reshape documents
- `$addFields` / `$set` - Add computed fields
- `$unwind` - Deconstruct arrays
- `$lookup` - Join collections
- `$count` - Count documents

### Cursor Operations

Chainable cursor methods for flexible queries.

```typescript
const cursor = collection.find({ status: 'active' })
  .sort({ createdAt: -1 })
  .skip(20)
  .limit(10)
  .project({ name: 1, email: 1 })

// Iterate
const docs = await cursor.toArray()

// Or use async iteration
for await (const doc of cursor) {
  console.log(doc.name)
}

// Or manual iteration
while (await cursor.hasNext()) {
  const doc = await cursor.next()
}

// Transform results
const names = await collection.find({})
  .map(doc => doc.name)
  .toArray()
```

### Index Support

Create indexes for query optimization.

```typescript
// Single field index
await collection.createIndex({ email: 1 })

// Compound index
await collection.createIndex({ lastName: 1, firstName: 1 })

// Unique index
await collection.createIndex({ email: 1 }, { unique: true })

// List indexes
const indexes = await collection.listIndexes().toArray()

// Drop index
await collection.dropIndex('email_1')
```

### BSON Types

Full BSON type support for MongoDB compatibility.

```typescript
import {
  ObjectId,
  Binary,
  Timestamp,
  Long,
  Decimal128,
  UUID,
  MinKey,
  MaxKey,
  Code
} from '@dotdo/mongo'

// ObjectId
const id = new ObjectId()
const fromHex = new ObjectId('507f1f77bcf86cd799439011')
const timestamp = id.getTimestamp() // Date

// Binary data
const binary = new Binary(new Uint8Array([1, 2, 3]))

// High-precision decimal
const price = Decimal128.fromString('19.99')

// 64-bit integers
const bigNum = new Long(BigInt('9007199254740993'))

// UUID
const uuid = UUID.generate()
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      Your Application                            │
│                                                                  │
│   const users = db.collection('users')                          │
│   await users.find({ age: { $gt: 21 } }).toArray()              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     @dotdo/mongo                                 │
│                                                                  │
│   - Full MongoDB driver API                                      │
│   - Query/update operator parsing                                │
│   - Aggregation pipeline execution                               │
│   - Index management                                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Durable Objects                               │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │   Agent 1   │  │   Agent 2   │  │   Agent N   │            │
│   │   SQLite    │  │   SQLite    │  │   SQLite    │            │
│   │    + JSON   │  │    + JSON   │  │    + JSON   │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   Global edge deployment - 300+ cities                          │
│   Instant reads - single-digit ms                               │
│   Durable writes - automatic replication                        │
└─────────────────────────────────────────────────────────────────┘
```

## Comparison

| Feature | Native MongoDB | @dotdo/mongo |
|---------|---------------|--------------|
| Connection pooling | Required | Not needed |
| Cold starts | ~500ms+ | 0ms |
| Edge deployment | Atlas only | Global (300+ cities) |
| Scaling | Manual sharding | Automatic |
| Per-agent isolation | Complex | Built-in |
| Driver API | Full | Full |
| Aggregation | Full | Core stages |
| Transactions | ACID | Per-DO |

## API Reference

### MongoClient

| Method | Description |
|--------|-------------|
| `createClient(url, options?)` | Create a new client |
| `client.connect()` | Connect to database |
| `client.close()` | Close connection |
| `client.db(name?)` | Get database |
| `client.startSession()` | Start a session |
| `client.withSession(fn)` | Run with session |

### Database

| Method | Description |
|--------|-------------|
| `db.collection(name)` | Get collection |
| `db.createCollection(name)` | Create collection |
| `db.listCollections()` | List collections |
| `db.dropCollection(name)` | Drop collection |
| `db.dropDatabase()` | Drop database |
| `db.stats()` | Get statistics |
| `db.admin()` | Get admin interface |

### Collection

| Method | Description |
|--------|-------------|
| `insertOne(doc)` | Insert one document |
| `insertMany(docs)` | Insert multiple documents |
| `findOne(filter)` | Find one document |
| `find(filter)` | Find documents (returns cursor) |
| `updateOne(filter, update)` | Update one document |
| `updateMany(filter, update)` | Update multiple documents |
| `replaceOne(filter, doc)` | Replace one document |
| `deleteOne(filter)` | Delete one document |
| `deleteMany(filter)` | Delete multiple documents |
| `findOneAndUpdate(filter, update)` | Find and update atomically |
| `findOneAndDelete(filter)` | Find and delete atomically |
| `findOneAndReplace(filter, doc)` | Find and replace atomically |
| `aggregate(pipeline)` | Run aggregation pipeline |
| `countDocuments(filter?)` | Count matching documents |
| `estimatedDocumentCount()` | Estimate total count |
| `distinct(field, filter?)` | Get distinct values |
| `createIndex(keys, options?)` | Create index |
| `dropIndex(name)` | Drop index |
| `listIndexes()` | List indexes |
| `drop()` | Drop collection |
| `stats()` | Get collection stats |

### FindCursor

| Method | Description |
|--------|-------------|
| `toArray()` | Get all results as array |
| `forEach(fn)` | Iterate with callback |
| `hasNext()` | Check if more results |
| `next()` | Get next result |
| `count()` | Count results |
| `limit(n)` | Limit results |
| `skip(n)` | Skip results |
| `sort(spec)` | Sort results |
| `project(spec)` | Project fields |
| `filter(spec)` | Add filter |
| `map(fn)` | Transform results |
| `close()` | Close cursor |

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withMongo } from '@dotdo/mongo/do'

class MyAgent extends withMongo(DO) {
  async onMessage(content: string) {
    // this.$.mongo is pre-configured
    const db = this.$.mongo.db('agent')

    await db.collection('messages').insertOne({
      content,
      timestamp: new Date()
    })

    const history = await db.collection('messages')
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray()

    return this.processWithHistory(content, history)
  }
}
```

### Extended Options

```typescript
const client = createClient('mongodb://localhost:27017', {
  // Durable Object namespace binding
  doNamespace: env.MONGO,

  // Sharding configuration
  shard: {
    algorithm: 'consistent',  // 'consistent' | 'range' | 'hash'
    count: 4,
    key: '_id'
  },

  // Replica configuration
  replica: {
    readPreference: 'nearest',  // 'primary' | 'secondary' | 'nearest'
    writeThrough: true,
    jurisdiction: 'eu'  // 'eu' | 'us' | 'fedramp'
  }
})
```

## Sessions and Transactions

```typescript
const session = client.startSession()

try {
  session.startTransaction()

  await users.insertOne({ name: 'Alice' }, { session })
  await accounts.insertOne({ owner: 'Alice', balance: 100 }, { session })

  await session.commitTransaction()
} catch (e) {
  await session.abortTransaction()
  throw e
} finally {
  await session.endSession()
}

// Or use withTransaction helper
await session.withTransaction(async () => {
  await users.insertOne({ name: 'Bob' })
  await accounts.insertOne({ owner: 'Bob', balance: 0 })
})
```

## Error Handling

```typescript
import {
  MongoError,
  MongoServerError,
  MongoDuplicateKeyError
} from '@dotdo/mongo'

try {
  await collection.insertOne({ _id: existingId, name: 'Test' })
} catch (e) {
  if (e instanceof MongoDuplicateKeyError) {
    console.log('Duplicate key:', e.keyValue)
    console.log('Key pattern:', e.keyPattern)
    console.log('Error code:', e.code)  // 11000
  }
}
```

## Performance

- **0ms cold starts** - V8 isolates, not containers
- **Single-digit ms reads** - Local SQLite storage
- **Durable writes** - Automatic replication
- **1,500+ tests** covering all operations
- **<1KB** added to bundle (tree-shakeable)

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://mongo.do)
- [dotdo](https://dotdo.dev)
- [Platform.do](https://platform.do)
