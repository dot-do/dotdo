# @dotdo/mongo

MongoDB-compatible client with pluggable storage backends.

## Installation

```bash
npm install @dotdo/mongo
```

## Usage

```typescript
import { MongoClient } from '@dotdo/mongo'

// Create client (uses in-memory backend by default)
const client = new MongoClient()
await client.connect()

// Access database and collection
const db = client.db('mydb')
const users = db.collection('users')

// CRUD operations
await users.insertOne({ name: 'Alice', age: 30 })
await users.insertMany([
  { name: 'Bob', age: 25 },
  { name: 'Charlie', age: 35 },
])

// Find documents
const alice = await users.findOne({ name: 'Alice' })
const adults = await users.find({ age: { $gte: 18 } }).toArray()

// Update documents
await users.updateOne(
  { name: 'Alice' },
  { $set: { age: 31 } }
)

// Delete documents
await users.deleteOne({ name: 'Bob' })
```

## Query Operators

### Comparison
- `$eq` - Equal to
- `$ne` - Not equal to
- `$gt` - Greater than
- `$gte` - Greater than or equal
- `$lt` - Less than
- `$lte` - Less than or equal
- `$in` - In array
- `$nin` - Not in array

### Logical
- `$and` - Logical AND
- `$or` - Logical OR
- `$nor` - Logical NOR

### Element
- `$exists` - Field exists

## Update Operators

- `$set` - Set field value
- `$unset` - Remove field
- `$inc` - Increment numeric field
- `$push` - Push value to array
- `$pull` - Remove value from array
- `$addToSet` - Add to array if not present
- `$pop` - Remove first/last from array
- `$min` - Set to minimum
- `$max` - Set to maximum
- `$mul` - Multiply numeric field
- `$rename` - Rename field

## Custom Backends

You can provide a custom backend by implementing the `Backend` interface:

```typescript
import { MongoClient, Backend } from '@dotdo/mongo'

const customBackend: Backend = {
  // Implement Backend interface methods
}

const client = new MongoClient(undefined, { backend: customBackend })
```

## License

MIT
