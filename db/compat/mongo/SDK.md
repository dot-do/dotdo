# MongoDB SDK Reference

## MongoClient

```typescript
import { MongoClient } from '@dotdo/mongo'

const client = new MongoClient({
  namespace: string      // Your app namespace
  apiKey?: string        // Optional API key
  colo?: string          // Preferred colo for geo routing
})
```

## Database

```typescript
const db = client.db('production')
```

## Collection

```typescript
const users = db.collection('User')
```

### find()

```typescript
// Basic query
const docs = await collection.find({ status: 'active' }).toArray()

// With operators
const docs = await collection.find({
  age: { $gte: 18, $lte: 65 },
  'data.email': { $exists: true },
  type: { $in: ['premium', 'trial'] }
}).toArray()

// With options
const docs = await collection
  .find({ status: 'active' })
  .project({ name: 1, email: 1 })
  .sort({ createdAt: -1 })
  .skip(20)
  .limit(10)
  .toArray()
```

### findOne()

```typescript
const user = await collection.findOne({ _id: 'user-123' })
```

### countDocuments()

```typescript
// Index-only operation - no cold storage access
const count = await collection.countDocuments({ type: 'User' })
```

### aggregate()

```typescript
const results = await collection.aggregate([
  { $match: { status: 'completed' } },
  { $group: { 
    _id: '$customerId',
    total: { $sum: '$amount' },
    count: { $count: {} }
  }},
  { $sort: { total: -1 } },
  { $limit: 10 }
]).toArray()
```

### insertOne() / insertMany()

```typescript
const result = await collection.insertOne({
  type: 'User',
  data: { name: 'Alice', email: 'alice@example.com' }
})

const results = await collection.insertMany([
  { type: 'User', data: { name: 'Bob' } },
  { type: 'User', data: { name: 'Charlie' } }
])
```

### updateOne() / updateMany()

```typescript
await collection.updateOne(
  { _id: 'user-123' },
  { $set: { 'data.status': 'active' } }
)

await collection.updateMany(
  { status: 'pending' },
  { $set: { status: 'processed' }, $inc: { attempts: 1 } }
)
```

### deleteOne() / deleteMany()

```typescript
await collection.deleteOne({ _id: 'user-123' })
await collection.deleteMany({ status: 'deleted' })
```

## Vector Search

```typescript
// Find similar items by embedding
const similar = await collection.find({
  $vector: {
    $near: [0.1, 0.2, 0.3, ...],  // Your embedding vector
    $k: 10,                        // Top K results
    $minScore: 0.8                 // Optional minimum similarity
  }
}).toArray()
```

## Full-Text Search

```typescript
// Full-text search with GIN index
const articles = await collection.find({
  $text: { 
    $search: 'cloudflare workers',
    $language: 'english',
    $caseSensitive: false
  }
}).toArray()
```

## Aggregation Stages Reference

### $match
Filter documents. Uses indexes when possible.
```typescript
{ $match: { status: 'active', age: { $gte: 18 } } }
```

### $project
Include, exclude, or compute fields.
```typescript
{ $project: { 
  name: 1, 
  email: 1,
  fullName: { $concat: ['$firstName', ' ', '$lastName'] }
}}
```

### $group
Group by key and compute aggregations.
```typescript
{ $group: {
  _id: '$category',
  count: { $count: {} },
  total: { $sum: '$amount' },
  avg: { $avg: '$amount' },
  items: { $push: '$name' }
}}
```

### $sort
Sort documents.
```typescript
{ $sort: { createdAt: -1, name: 1 } }
```

### $limit / $skip
Paginate results.
```typescript
{ $skip: 20 }
{ $limit: 10 }
```

### $unwind
Deconstruct array field.
```typescript
{ $unwind: '$tags' }
{ $unwind: { path: '$items', preserveNullAndEmptyArrays: true } }
```

### $lookup
Left outer join with another collection.
```typescript
{ $lookup: {
  from: 'Order',
  localField: '_id',
  foreignField: 'userId',
  as: 'orders'
}}
```

### $facet
Execute multiple pipelines in parallel.
```typescript
{ $facet: {
  byStatus: [
    { $group: { _id: '$status', count: { $count: {} } } }
  ],
  byCategory: [
    { $group: { _id: '$category', count: { $count: {} } } }
  ],
  total: [
    { $count: 'count' }
  ]
}}
```

### $bucket
Create histogram buckets.
```typescript
{ $bucket: {
  groupBy: '$price',
  boundaries: [0, 100, 500, 1000, Infinity],
  default: 'Other',
  output: { count: { $count: {} } }
}}
```

## Query Statistics

All queries return statistics:

```typescript
const { data, stats } = await collection.find({ ... }).explain()

console.log(stats)
// {
//   parseTimeMs: 0.5,
//   routingTimeMs: 1.2,
//   indexTimeMs: 2.3,
//   fetchTimeMs: 45.0,
//   aggregateTimeMs: 3.1,
//   totalTimeMs: 52.1,
//   shardsQueried: 1,
//   partitionsPruned: 950,
//   partitionsFetched: 50,
//   cacheHits: 45,
//   cacheMisses: 5,
//   rowsScanned: 50000,
//   rowsReturned: 127
// }
```
