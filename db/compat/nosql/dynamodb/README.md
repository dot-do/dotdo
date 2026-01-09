# dynamodb.do

**DynamoDB for Cloudflare Workers.** AWS SDK-compatible. Edge-native. No capacity planning.

[![npm version](https://img.shields.io/npm/v/@dotdo/dynamodb.svg)](https://www.npmjs.com/package/@dotdo/dynamodb)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why dynamodb.do?

**Your existing DynamoDB code.** Same `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` APIs. No rewrites.

**No AWS connections.** Traditional DynamoDB requires HTTP connections to AWS regions, connection signing, and cold starts. dynamodb.do runs entirely on Durable Object storage - no network latency, no IAM complexity.

**Scales to millions of agents.** Each agent gets isolated DynamoDB-compatible storage backed by Durable Objects. No provisioned capacity. No throughput limits. No noisy neighbors.

```typescript
import { DynamoDBClient } from '@dotdo/dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@dotdo/dynamodb/lib'

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

// Same API you already know
await docClient.send(new PutCommand({
  TableName: 'users',
  Item: { pk: 'USER#123', sk: 'PROFILE', name: 'Alice', email: 'alice@example.com' }
}))

const { Item } = await docClient.send(new GetCommand({
  TableName: 'users',
  Key: { pk: 'USER#123', sk: 'PROFILE' }
}))
```

## Installation

```bash
npm install @dotdo/dynamodb
```

## Quick Start

```typescript
import { DynamoDBClient } from '@dotdo/dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand
} from '@dotdo/dynamodb/lib'

// Create clients
const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

// Put an item
await docClient.send(new PutCommand({
  TableName: 'orders',
  Item: {
    pk: 'ORDER#001',
    sk: 'META',
    customerId: 'CUST#123',
    total: 99.99,
    status: 'pending'
  }
}))

// Get an item
const { Item } = await docClient.send(new GetCommand({
  TableName: 'orders',
  Key: { pk: 'ORDER#001', sk: 'META' }
}))

// Query by partition key
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': 'ORDER#001' }
}))

// Delete an item
await docClient.send(new DeleteCommand({
  TableName: 'orders',
  Key: { pk: 'ORDER#001', sk: 'META' }
}))
```

## How It Works

```
+---------------------------------------------------------------------+
|                       Your Application                               |
|                                                                      |
|   await docClient.send(new QueryCommand({                           |
|     TableName: 'orders',                                            |
|     KeyConditionExpression: 'pk = :pk AND sk BEGINS_WITH :sk',      |
|   }))                                                               |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                       @dotdo/dynamodb                                |
|                                                                      |
|   - Full AWS SDK v3 API compatibility                               |
|   - DynamoDBClient + DynamoDBDocumentClient                         |
|   - Expression parsing (Key, Filter, Projection, Update)            |
|   - Automatic GSI/LSI support                                       |
+-----------------------------------+---------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    Durable Object SQLite                             |
|                                                                      |
|   Tables     -> SQLite tables with JSON columns                     |
|   GSI/LSI    -> Automatic secondary indexes                         |
|   Queries    -> Optimized SQL with B-tree indexes                   |
|   Scans      -> Full table iteration with filters                   |
|                                                                      |
|   Global edge deployment - 300+ cities                              |
|   Instant reads - single-digit ms                                   |
|   Durable writes - automatic replication                            |
+---------------------------------------------------------------------+
```

## Features

### Complete CRUD Operations

Every command from the AWS SDK works exactly as expected.

```typescript
// PutCommand - Insert or replace
await docClient.send(new PutCommand({
  TableName: 'users',
  Item: { pk: 'USER#123', sk: 'PROFILE', name: 'Alice' },
  ConditionExpression: 'attribute_not_exists(pk)'
}))

// GetCommand - Retrieve by key
const { Item } = await docClient.send(new GetCommand({
  TableName: 'users',
  Key: { pk: 'USER#123', sk: 'PROFILE' },
  ProjectionExpression: 'name, email'
}))

// UpdateCommand - Modify attributes
await docClient.send(new UpdateCommand({
  TableName: 'users',
  Key: { pk: 'USER#123', sk: 'PROFILE' },
  UpdateExpression: 'SET #n = :name, updatedAt = :now',
  ExpressionAttributeNames: { '#n': 'name' },
  ExpressionAttributeValues: { ':name': 'Alicia', ':now': Date.now() }
}))

// DeleteCommand - Remove item
await docClient.send(new DeleteCommand({
  TableName: 'users',
  Key: { pk: 'USER#123', sk: 'PROFILE' },
  ReturnValues: 'ALL_OLD'
}))
```

### Query Operations

Full key condition and filter expression support.

```typescript
// Query by partition key
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': 'CUSTOMER#123' }
}))

// Query with sort key range
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
  ExpressionAttributeValues: {
    ':pk': 'CUSTOMER#123',
    ':start': '2024-01-01',
    ':end': '2024-12-31'
  }
}))

// Query with BEGINS_WITH
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
  ExpressionAttributeValues: {
    ':pk': 'CUSTOMER#123',
    ':prefix': 'ORDER#'
  }
}))

// Query with filter expression
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk',
  FilterExpression: '#status = :status AND total > :min',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: {
    ':pk': 'CUSTOMER#123',
    ':status': 'completed',
    ':min': 100
  }
}))

// Query in descending order with limit
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'orders',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': 'CUSTOMER#123' },
  ScanIndexForward: false,
  Limit: 10
}))
```

### Scan Operations

Full table scans with filter expressions.

```typescript
// Simple scan
const { Items } = await docClient.send(new ScanCommand({
  TableName: 'products'
}))

// Scan with filter
const { Items } = await docClient.send(new ScanCommand({
  TableName: 'products',
  FilterExpression: 'price < :max AND category = :cat',
  ExpressionAttributeValues: {
    ':max': 50,
    ':cat': 'electronics'
  }
}))

// Paginated scan
let lastKey = undefined
const allItems = []

do {
  const { Items, LastEvaluatedKey } = await docClient.send(new ScanCommand({
    TableName: 'products',
    Limit: 100,
    ExclusiveStartKey: lastKey
  }))
  allItems.push(...Items)
  lastKey = LastEvaluatedKey
} while (lastKey)
```

### Batch Operations

Process multiple items in a single request.

```typescript
// BatchGetCommand - Get multiple items
const { Responses } = await docClient.send(new BatchGetCommand({
  RequestItems: {
    users: {
      Keys: [
        { pk: 'USER#1', sk: 'PROFILE' },
        { pk: 'USER#2', sk: 'PROFILE' },
        { pk: 'USER#3', sk: 'PROFILE' }
      ]
    }
  }
}))

// BatchWriteCommand - Put/Delete multiple items
await docClient.send(new BatchWriteCommand({
  RequestItems: {
    users: [
      { PutRequest: { Item: { pk: 'USER#1', sk: 'PROFILE', name: 'Alice' } } },
      { PutRequest: { Item: { pk: 'USER#2', sk: 'PROFILE', name: 'Bob' } } },
      { DeleteRequest: { Key: { pk: 'USER#3', sk: 'PROFILE' } } }
    ]
  }
}))
```

### Transactions

Atomic operations across multiple items.

```typescript
// TransactWriteCommand - Atomic writes
await docClient.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: 'orders',
        Item: { pk: 'ORDER#123', sk: 'META', status: 'confirmed' }
      }
    },
    {
      Update: {
        TableName: 'inventory',
        Key: { pk: 'PRODUCT#456', sk: 'STOCK' },
        UpdateExpression: 'SET quantity = quantity - :dec',
        ExpressionAttributeValues: { ':dec': 1 }
      }
    },
    {
      Delete: {
        TableName: 'cart',
        Key: { pk: 'CART#789', sk: 'ITEM#456' }
      }
    }
  ]
}))

// TransactGetCommand - Consistent reads
const { Responses } = await docClient.send(new TransactGetCommand({
  TransactItems: [
    { Get: { TableName: 'users', Key: { pk: 'USER#1', sk: 'PROFILE' } } },
    { Get: { TableName: 'orders', Key: { pk: 'ORDER#123', sk: 'META' } } }
  ]
}))
```

### Key Condition Expressions

Full support for partition and sort key conditions.

```typescript
// Equality
'pk = :pk'

// Sort key conditions
'pk = :pk AND sk = :sk'                    // Equals
'pk = :pk AND sk < :sk'                    // Less than
'pk = :pk AND sk <= :sk'                   // Less than or equal
'pk = :pk AND sk > :sk'                    // Greater than
'pk = :pk AND sk >= :sk'                   // Greater than or equal
'pk = :pk AND sk BETWEEN :start AND :end'  // Range
'pk = :pk AND begins_with(sk, :prefix)'    // Prefix match
```

### Filter Expressions

Post-query filtering with rich operators.

```typescript
// Comparison
'age > :min'
'age >= :min'
'age < :max'
'age <= :max'
'age <> :val'
'age BETWEEN :min AND :max'

// String functions
'begins_with(email, :domain)'
'contains(tags, :tag)'
'size(items) > :min'

// Existence checks
'attribute_exists(email)'
'attribute_not_exists(deletedAt)'

// Type checks
'attribute_type(data, :type)'  // S, N, B, SS, NS, BS, M, L, NULL, BOOL

// Logical operators
'age > :min AND verified = :true'
'role = :admin OR role = :mod'
'NOT banned = :true'

// IN operator
'category IN (:cat1, :cat2, :cat3)'

// Parentheses for grouping
'(role = :admin OR role = :mod) AND active = :true'
```

### Update Expressions

Powerful attribute modifications.

```typescript
// SET - Add or modify attributes
'SET name = :name'
'SET #count = #count + :inc'              // Increment
'SET updatedAt = if_not_exists(updatedAt, :now)'  // Default value
'SET #list = list_append(#list, :items)'  // Append to list

// REMOVE - Delete attributes
'REMOVE temporaryField, anotherField'

// ADD - Numeric increment or set addition
'ADD viewCount :inc'                       // Increment number
'ADD tags :newTags'                        // Add to set

// DELETE - Remove from set
'DELETE tags :oldTags'

// Combined operations
'SET updatedAt = :now, version = version + :one REMOVE deletedAt'
```

### Projection Expressions

Select specific attributes to return.

```typescript
const { Item } = await docClient.send(new GetCommand({
  TableName: 'users',
  Key: { pk: 'USER#123', sk: 'PROFILE' },
  ProjectionExpression: 'pk, sk, #n, email, address.city',
  ExpressionAttributeNames: { '#n': 'name' }
}))
// Returns only: pk, sk, name, email, address.city
```

## API Reference

### Client Commands

| Command | Description |
|---------|-------------|
| `DynamoDBClient` | Base client for low-level operations |
| `DynamoDBDocumentClient` | High-level client with automatic marshalling |

### Document Commands

| Command | Description |
|---------|-------------|
| `GetCommand` | Retrieve single item by primary key |
| `PutCommand` | Create or replace item |
| `UpdateCommand` | Modify item attributes |
| `DeleteCommand` | Remove item |
| `QueryCommand` | Query items by partition key |
| `ScanCommand` | Scan all items with optional filter |
| `BatchGetCommand` | Get multiple items in one request |
| `BatchWriteCommand` | Put/Delete multiple items in one request |
| `TransactGetCommand` | Transactional get of multiple items |
| `TransactWriteCommand` | Transactional write of multiple items |

### Command Options

| Option | Commands | Description |
|--------|----------|-------------|
| `TableName` | All | Target table name |
| `Key` | Get, Update, Delete | Primary key (pk + sk) |
| `Item` | Put | Full item to store |
| `KeyConditionExpression` | Query | Partition/sort key conditions |
| `FilterExpression` | Query, Scan | Post-retrieval filtering |
| `ProjectionExpression` | Get, Query, Scan | Attributes to return |
| `UpdateExpression` | Update | SET/REMOVE/ADD/DELETE operations |
| `ConditionExpression` | Put, Update, Delete | Conditional write |
| `ExpressionAttributeNames` | All | Placeholder for reserved words |
| `ExpressionAttributeValues` | All | Placeholder for values |
| `ReturnValues` | Put, Update, Delete | Return old/new values |
| `Limit` | Query, Scan | Maximum items to return |
| `ScanIndexForward` | Query | Sort order (true=asc, false=desc) |
| `ExclusiveStartKey` | Query, Scan | Pagination start key |
| `ConsistentRead` | Get, Query, Scan | Strong consistency |

## Comparison

| Feature | AWS DynamoDB | @dotdo/dynamodb |
|---------|--------------|-----------------|
| Connection | HTTPS to AWS | None needed |
| Cold starts | ~100-500ms | 0ms |
| Capacity planning | Required | Not needed |
| Provisioned throughput | Required | Unlimited |
| Read/write pricing | Per request | Per DO storage |
| Edge deployment | Single region | 300+ cities |
| Per-agent isolation | Complex | Built-in |
| SDK compatibility | Native | Full |
| GSI/LSI | Yes | Automatic |
| Transactions | Yes | Yes |
| Batch operations | Yes | Yes |

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withDynamoDB } from '@dotdo/dynamodb/do'

class OrderProcessor extends withDynamoDB(DO) {
  async createOrder(customerId: string, items: Item[]) {
    const orderId = crypto.randomUUID()

    await this.dynamodb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: 'orders',
            Item: {
              pk: `CUSTOMER#${customerId}`,
              sk: `ORDER#${orderId}`,
              items,
              status: 'pending',
              createdAt: Date.now()
            }
          }
        },
        ...items.map(item => ({
          Update: {
            TableName: 'inventory',
            Key: { pk: `PRODUCT#${item.productId}`, sk: 'STOCK' },
            UpdateExpression: 'SET quantity = quantity - :dec',
            ConditionExpression: 'quantity >= :dec',
            ExpressionAttributeValues: { ':dec': item.quantity }
          }
        }))
      ]
    }))

    return orderId
  }
}
```

### Extended Options

```typescript
import { DynamoDBClient } from '@dotdo/dynamodb'

const client = new DynamoDBClient({
  // Durable Object namespace binding
  doNamespace: env.DYNAMODB,

  // Sharding configuration
  shard: {
    algorithm: 'consistent',
    count: 16,
    key: 'pk'
  },

  // Replica configuration
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu'
  }
})
```

## Common Patterns

### Single-Table Design

```typescript
// Users, orders, and products in one table
const items = [
  // User profile
  { pk: 'USER#123', sk: 'PROFILE', name: 'Alice', email: 'alice@example.com' },
  // User's orders
  { pk: 'USER#123', sk: 'ORDER#001', total: 99.99, status: 'shipped' },
  { pk: 'USER#123', sk: 'ORDER#002', total: 149.99, status: 'pending' },
  // Products
  { pk: 'PRODUCT#456', sk: 'META', name: 'Widget', price: 29.99 },
  { pk: 'PRODUCT#456', sk: 'STOCK', quantity: 100 }
]

// Get user with all orders
const { Items } = await docClient.send(new QueryCommand({
  TableName: 'app',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': 'USER#123' }
}))
```

### Optimistic Locking

```typescript
async function updateWithVersion(key: Key, updates: object) {
  const { Item } = await docClient.send(new GetCommand({
    TableName: 'items',
    Key: key
  }))

  const currentVersion = Item?.version || 0

  await docClient.send(new UpdateCommand({
    TableName: 'items',
    Key: key,
    UpdateExpression: 'SET #data = :data, version = :newVersion',
    ConditionExpression: 'version = :currentVersion',
    ExpressionAttributeNames: { '#data': 'data' },
    ExpressionAttributeValues: {
      ':data': updates,
      ':currentVersion': currentVersion,
      ':newVersion': currentVersion + 1
    }
  }))
}
```

### Time-Series Data

```typescript
// Store events with timestamp-based sort key
await docClient.send(new PutCommand({
  TableName: 'events',
  Item: {
    pk: `DEVICE#${deviceId}`,
    sk: `EVENT#${Date.now()}`,
    type: 'temperature',
    value: 72.5
  }
}))

// Query last hour of events
const oneHourAgo = Date.now() - 3600000

const { Items } = await docClient.send(new QueryCommand({
  TableName: 'events',
  KeyConditionExpression: 'pk = :pk AND sk >= :start',
  ExpressionAttributeValues: {
    ':pk': `DEVICE#${deviceId}`,
    ':start': `EVENT#${oneHourAgo}`
  },
  ScanIndexForward: false  // Most recent first
}))
```

## Performance

- **0ms cold starts** - V8 isolates, not containers
- **Single-digit ms reads** - Local SQLite storage
- **Durable writes** - Automatic replication
- **No capacity planning** - Unlimited throughput
- **Automatic indexing** - GSI/LSI backed by SQLite indexes

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://dynamodb.do)
- [dotdo](https://dotdo.dev)
- [Platform.do](https://platform.do)
