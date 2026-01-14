/**
 * @dotdo/dynamodb - AWS DynamoDB SDK compat tests
 *
 * Tests for AWS DynamoDB SDK API compatibility backed by DO SQLite with JSON storage:
 * - DynamoDBClient
 * - Table operations: CreateTable, DeleteTable, DescribeTable, ListTables
 * - Item operations: PutItem, GetItem, UpdateItem, DeleteItem
 * - Query and Scan operations
 * - Batch operations: BatchWriteItem, BatchGetItem
 * - Transaction operations: TransactWriteItems, TransactGetItems
 * - Condition expressions, filter expressions, update expressions
 * - Marshalling/unmarshalling utilities
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DynamoDBClient,
  createClient,
  clearAllTables,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
  BatchGetItemCommand,
  TransactGetItemsCommand,
  TransactWriteItemsCommand,
  ResourceNotFoundException,
  ResourceInUseException,
  ConditionalCheckFailedException,
  TransactionCanceledException,
  ValidationException,
  marshall,
  marshallItem,
  unmarshall,
  unmarshallItem,
} from './index'
import type { AttributeValue, Item } from './types'

// ============================================================================
// MARSHALLING TESTS
// ============================================================================

describe('Marshalling utilities', () => {
  describe('marshall', () => {
    it('should marshall string', () => {
      expect(marshall('hello')).toEqual({ S: 'hello' })
    })

    it('should marshall number', () => {
      expect(marshall(42)).toEqual({ N: '42' })
    })

    it('should marshall boolean', () => {
      expect(marshall(true)).toEqual({ BOOL: true })
      expect(marshall(false)).toEqual({ BOOL: false })
    })

    it('should marshall null', () => {
      expect(marshall(null)).toEqual({ NULL: true })
    })

    it('should marshall undefined', () => {
      expect(marshall(undefined)).toEqual({ NULL: true })
    })

    it('should marshall array', () => {
      expect(marshall([1, 2, 3])).toEqual({
        L: [{ N: '1' }, { N: '2' }, { N: '3' }],
      })
    })

    it('should marshall object', () => {
      expect(marshall({ name: 'Alice', age: 30 })).toEqual({
        M: {
          name: { S: 'Alice' },
          age: { N: '30' },
        },
      })
    })

    it('should marshall Uint8Array', () => {
      const binary = new Uint8Array([1, 2, 3])
      expect(marshall(binary)).toEqual({ B: binary })
    })

    it('should marshall nested objects', () => {
      expect(marshall({ user: { name: 'Alice', scores: [90, 85] } })).toEqual({
        M: {
          user: {
            M: {
              name: { S: 'Alice' },
              scores: { L: [{ N: '90' }, { N: '85' }] },
            },
          },
        },
      })
    })
  })

  describe('marshallItem', () => {
    it('should marshall an object to DynamoDB item format', () => {
      const result = marshallItem({ pk: 'user#1', name: 'Alice', age: 30 })
      expect(result).toEqual({
        pk: { S: 'user#1' },
        name: { S: 'Alice' },
        age: { N: '30' },
      })
    })
  })

  describe('unmarshall', () => {
    it('should unmarshall string', () => {
      expect(unmarshall({ S: 'hello' })).toBe('hello')
    })

    it('should unmarshall number', () => {
      expect(unmarshall({ N: '42' })).toBe(42)
    })

    it('should unmarshall boolean', () => {
      expect(unmarshall({ BOOL: true })).toBe(true)
    })

    it('should unmarshall null', () => {
      expect(unmarshall({ NULL: true })).toBeNull()
    })

    it('should unmarshall list', () => {
      expect(unmarshall({ L: [{ N: '1' }, { N: '2' }] })).toEqual([1, 2])
    })

    it('should unmarshall map', () => {
      expect(unmarshall({ M: { name: { S: 'Alice' } } })).toEqual({ name: 'Alice' })
    })

    it('should unmarshall string set', () => {
      const result = unmarshall({ SS: ['a', 'b', 'c'] })
      expect(result).toBeInstanceOf(Set)
      expect(result).toEqual(new Set(['a', 'b', 'c']))
    })

    it('should unmarshall number set', () => {
      const result = unmarshall({ NS: ['1', '2', '3'] })
      expect(result).toBeInstanceOf(Set)
      expect(result).toEqual(new Set([1, 2, 3]))
    })
  })

  describe('unmarshallItem', () => {
    it('should unmarshall DynamoDB item to object', () => {
      const result = unmarshallItem({
        pk: { S: 'user#1' },
        name: { S: 'Alice' },
        age: { N: '30' },
      })
      expect(result).toEqual({ pk: 'user#1', name: 'Alice', age: 30 })
    })
  })
})

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('DynamoDBClient', () => {
  it('should create client with createClient', () => {
    const client = createClient({ region: 'us-east-1' })
    expect(client).toBeDefined()
    expect(client.config.region).toBe('us-east-1')
  })

  it('should create client with new DynamoDBClient', () => {
    const client = new DynamoDBClient({ region: 'us-west-2' })
    expect(client).toBeDefined()
    expect(client.config.region).toBe('us-west-2')
  })

  it('should create client without config', () => {
    const client = new DynamoDBClient()
    expect(client).toBeDefined()
  })

  it('should destroy client without error', () => {
    const client = new DynamoDBClient()
    expect(() => client.destroy()).not.toThrow()
  })
})

// ============================================================================
// TABLE OPERATIONS TESTS
// ============================================================================

describe('Table operations', () => {
  let client: DynamoDBClient

  beforeEach(() => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
  })

  describe('CreateTableCommand', () => {
    it('should create a simple table', async () => {
      const result = await client.send(
        new CreateTableCommand({
          TableName: 'Users',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )

      expect(result.TableDescription).toBeDefined()
      expect(result.TableDescription?.TableName).toBe('Users')
      expect(result.TableDescription?.TableStatus).toBe('ACTIVE')
      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should create table with sort key', async () => {
      const result = await client.send(
        new CreateTableCommand({
          TableName: 'Orders',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
        })
      )

      expect(result.TableDescription?.KeySchema).toHaveLength(2)
    })

    it('should create table with provisioned throughput', async () => {
      const result = await client.send(
        new CreateTableCommand({
          TableName: 'ProvisionedTable',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        })
      )

      expect(result.TableDescription?.ProvisionedThroughput?.ReadCapacityUnits).toBe(5)
    })

    it('should create table with GSI', async () => {
      const result = await client.send(
        new CreateTableCommand({
          TableName: 'WithGSI',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'gsi_pk', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'GSI1',
              KeySchema: [{ AttributeName: 'gsi_pk', KeyType: 'HASH' }],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
        })
      )

      expect(result.TableDescription?.GlobalSecondaryIndexes).toHaveLength(1)
      expect(result.TableDescription?.GlobalSecondaryIndexes?.[0].IndexName).toBe('GSI1')
    })

    it('should throw ResourceInUseException for duplicate table', async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'DuplicateTable',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )

      await expect(
        client.send(
          new CreateTableCommand({
            TableName: 'DuplicateTable',
            KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
          })
        )
      ).rejects.toThrow(ResourceInUseException)
    })
  })

  describe('DescribeTableCommand', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'TestTable',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )
    })

    it('should describe existing table', async () => {
      const result = await client.send(
        new DescribeTableCommand({ TableName: 'TestTable' })
      )

      expect(result.Table?.TableName).toBe('TestTable')
      expect(result.Table?.TableStatus).toBe('ACTIVE')
      expect(result.Table?.ItemCount).toBe(0)
    })

    it('should throw ResourceNotFoundException for non-existent table', async () => {
      await expect(
        client.send(new DescribeTableCommand({ TableName: 'NonExistent' }))
      ).rejects.toThrow(ResourceNotFoundException)
    })
  })

  describe('ListTablesCommand', () => {
    beforeEach(async () => {
      for (const name of ['Table1', 'Table2', 'Table3']) {
        await client.send(
          new CreateTableCommand({
            TableName: name,
            KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
          })
        )
      }
    })

    it('should list all tables', async () => {
      const result = await client.send(new ListTablesCommand({}))

      expect(result.TableNames).toContain('Table1')
      expect(result.TableNames).toContain('Table2')
      expect(result.TableNames).toContain('Table3')
    })

    it('should respect limit', async () => {
      const result = await client.send(new ListTablesCommand({ Limit: 2 }))

      expect(result.TableNames).toHaveLength(2)
      expect(result.LastEvaluatedTableName).toBeDefined()
    })

    it('should paginate with ExclusiveStartTableName', async () => {
      const first = await client.send(new ListTablesCommand({ Limit: 1 }))
      const second = await client.send(
        new ListTablesCommand({
          ExclusiveStartTableName: first.TableNames![0],
        })
      )

      expect(second.TableNames).not.toContain(first.TableNames![0])
    })
  })

  describe('DeleteTableCommand', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'ToDelete',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )
    })

    it('should delete existing table', async () => {
      const result = await client.send(
        new DeleteTableCommand({ TableName: 'ToDelete' })
      )

      expect(result.TableDescription?.TableStatus).toBe('DELETING')

      await expect(
        client.send(new DescribeTableCommand({ TableName: 'ToDelete' }))
      ).rejects.toThrow(ResourceNotFoundException)
    })

    it('should throw ResourceNotFoundException for non-existent table', async () => {
      await expect(
        client.send(new DeleteTableCommand({ TableName: 'NonExistent' }))
      ).rejects.toThrow(ResourceNotFoundException)
    })
  })
})

// ============================================================================
// ITEM OPERATIONS TESTS
// ============================================================================

describe('Item operations', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'Items',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
      })
    )
  })

  describe('PutItemCommand', () => {
    it('should put a simple item', async () => {
      const result = await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#1' },
            sk: { S: 'profile' },
            name: { S: 'Alice' },
            age: { N: '30' },
          },
        })
      )

      expect(result.$metadata.httpStatusCode).toBe(200)
    })

    it('should put item with complex types', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#2' },
            sk: { S: 'data' },
            tags: { SS: ['admin', 'user'] },
            scores: { L: [{ N: '100' }, { N: '200' }] },
            metadata: {
              M: {
                created: { S: '2025-01-01' },
                active: { BOOL: true },
              },
            },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#2' }, sk: { S: 'data' } },
        })
      )

      expect(result.Item?.tags?.SS).toContain('admin')
      expect(result.Item?.scores?.L).toHaveLength(2)
      expect(result.Item?.metadata?.M?.active?.BOOL).toBe(true)
    })

    it('should return old item with ReturnValues ALL_OLD', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#3' },
            sk: { S: 'profile' },
            name: { S: 'Bob' },
          },
        })
      )

      const result = await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#3' },
            sk: { S: 'profile' },
            name: { S: 'Robert' },
          },
          ReturnValues: 'ALL_OLD',
        })
      )

      expect(result.Attributes?.name?.S).toBe('Bob')
    })

    it('should respect condition expression', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#4' },
            sk: { S: 'profile' },
            name: { S: 'Charlie' },
          },
        })
      )

      // Should fail because item exists
      await expect(
        client.send(
          new PutItemCommand({
            TableName: 'Items',
            Item: {
              pk: { S: 'user#4' },
              sk: { S: 'profile' },
              name: { S: 'Chuck' },
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          })
        )
      ).rejects.toThrow(ConditionalCheckFailedException)
    })
  })

  describe('GetItemCommand', () => {
    beforeEach(async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#1' },
            sk: { S: 'profile' },
            name: { S: 'Alice' },
            age: { N: '30' },
            email: { S: 'alice@example.com.ai' },
          },
        })
      )
    })

    it('should get existing item', async () => {
      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.name?.S).toBe('Alice')
      expect(result.Item?.age?.N).toBe('30')
    })

    it('should return undefined for non-existent item', async () => {
      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#999' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item).toBeUndefined()
    })

    it('should respect projection expression', async () => {
      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          ProjectionExpression: 'name, age',
        })
      )

      expect(result.Item?.name?.S).toBe('Alice')
      expect(result.Item?.age?.N).toBe('30')
      expect(result.Item?.email).toBeUndefined()
    })
  })

  describe('UpdateItemCommand', () => {
    beforeEach(async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#1' },
            sk: { S: 'profile' },
            name: { S: 'Alice' },
            age: { N: '30' },
            views: { N: '0' },
          },
        })
      )
    })

    it('should update with SET', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'SET age = :newAge',
          ExpressionAttributeValues: { ':newAge': { N: '31' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.age?.N).toBe('31')
    })

    it('should update with ADD for numbers', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'ADD views :inc',
          ExpressionAttributeValues: { ':inc': { N: '5' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.views?.N).toBe('5')
    })

    it('should update with REMOVE', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'REMOVE views',
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.views).toBeUndefined()
    })

    it('should update with arithmetic expression', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'SET views = views + :inc',
          ExpressionAttributeValues: { ':inc': { N: '10' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.views?.N).toBe('10')
    })

    it('should update with if_not_exists', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'SET status = if_not_exists(status, :default)',
          ExpressionAttributeValues: { ':default': { S: 'active' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.status?.S).toBe('active')
    })

    it('should return ALL_NEW', async () => {
      const result = await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          UpdateExpression: 'SET age = :newAge',
          ExpressionAttributeValues: { ':newAge': { N: '31' } },
          ReturnValues: 'ALL_NEW',
        })
      )

      expect(result.Attributes?.age?.N).toBe('31')
    })

    it('should create item if not exists', async () => {
      await client.send(
        new UpdateItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#new' }, sk: { S: 'profile' } },
          UpdateExpression: 'SET name = :name',
          ExpressionAttributeValues: { ':name': { S: 'NewUser' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#new' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item?.name?.S).toBe('NewUser')
    })
  })

  describe('DeleteItemCommand', () => {
    beforeEach(async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'Items',
          Item: {
            pk: { S: 'user#1' },
            sk: { S: 'profile' },
            name: { S: 'Alice' },
          },
        })
      )
    })

    it('should delete existing item', async () => {
      await client.send(
        new DeleteItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
        })
      )

      expect(result.Item).toBeUndefined()
    })

    it('should return old item with ReturnValues ALL_OLD', async () => {
      const result = await client.send(
        new DeleteItemCommand({
          TableName: 'Items',
          Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
          ReturnValues: 'ALL_OLD',
        })
      )

      expect(result.Attributes?.name?.S).toBe('Alice')
    })

    it('should respect condition expression', async () => {
      await expect(
        client.send(
          new DeleteItemCommand({
            TableName: 'Items',
            Key: { pk: { S: 'user#1' }, sk: { S: 'profile' } },
            ConditionExpression: 'age > :minAge',
            ExpressionAttributeValues: { ':minAge': { N: '50' } },
          })
        )
      ).rejects.toThrow(ConditionalCheckFailedException)
    })
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('QueryCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'Orders',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
      })
    )

    // Insert test data
    for (let i = 1; i <= 5; i++) {
      await client.send(
        new PutItemCommand({
          TableName: 'Orders',
          Item: {
            pk: { S: 'USER#1' },
            sk: { S: `ORDER#00${i}` },
            amount: { N: String(i * 100) },
            status: { S: i % 2 === 0 ? 'completed' : 'pending' },
          },
        })
      )
    }

    // Add items for another user
    await client.send(
      new PutItemCommand({
        TableName: 'Orders',
        Item: {
          pk: { S: 'USER#2' },
          sk: { S: 'ORDER#001' },
          amount: { N: '150' },
          status: { S: 'completed' },
        },
      })
    )
  })

  it('should query by partition key', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'USER#1' } },
      })
    )

    expect(result.Count).toBe(5)
    expect(result.Items).toHaveLength(5)
  })

  it('should query with sort key condition', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND sk > :sk',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':sk': { S: 'ORDER#003' },
        },
      })
    )

    expect(result.Count).toBe(2)
  })

  it('should query with begins_with', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':prefix': { S: 'ORDER#00' },
        },
      })
    )

    expect(result.Count).toBe(5)
  })

  it('should query with begins_with case-sensitive', async () => {
    // Add an item with lowercase sk
    await client.send(
      new PutItemCommand({
        TableName: 'Orders',
        Item: {
          pk: { S: 'USER#1' },
          sk: { S: 'order#006' }, // lowercase
          amount: { N: '600' },
          status: { S: 'pending' },
        },
      })
    )

    // begins_with is case-sensitive, so searching for 'ORDER#' should not match 'order#'
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':prefix': { S: 'ORDER#' },
        },
      })
    )

    // Should only match the 5 uppercase ORDER# items, not the lowercase order#006
    expect(result.Count).toBe(5)

    // Now search with lowercase prefix should match only the lowercase item
    const result2 = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':prefix': { S: 'order#' },
        },
      })
    )

    expect(result2.Count).toBe(1)
    expect(result2.Items![0].sk?.S).toBe('order#006')
  })

  it('should query with begins_with empty prefix matches all', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':prefix': { S: '' }, // empty prefix matches all
        },
      })
    )

    // Empty prefix should match all items for USER#1
    expect(result.Count).toBe(5)
  })

  it('should query with begins_with using ExpressionAttributeNames', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':prefix': { S: 'ORDER#00' },
        },
      })
    )

    expect(result.Count).toBe(5)
  })

  it('should query with BETWEEN', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':start': { S: 'ORDER#002' },
          ':end': { S: 'ORDER#004' },
        },
      })
    )

    expect(result.Count).toBe(3)
  })

  it('should query with filter expression', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'status = :status',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#1' },
          ':status': { S: 'completed' },
        },
      })
    )

    expect(result.Count).toBe(2)
    expect(result.ScannedCount).toBe(5)
  })

  it('should query with limit', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'USER#1' } },
        Limit: 2,
      })
    )

    expect(result.Count).toBe(2)
  })

  it('should query in descending order', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'USER#1' } },
        ScanIndexForward: false,
      })
    )

    expect(result.Items![0].sk?.S).toBe('ORDER#005')
  })

  it('should query with projection', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'USER#1' } },
        ProjectionExpression: 'pk, sk',
        Limit: 1,
      })
    )

    expect(result.Items![0].pk).toBeDefined()
    expect(result.Items![0].sk).toBeDefined()
    expect(result.Items![0].amount).toBeUndefined()
  })

  it('should query with SELECT COUNT', async () => {
    const result = await client.send(
      new QueryCommand({
        TableName: 'Orders',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': { S: 'USER#1' } },
        Select: 'COUNT',
      })
    )

    expect(result.Count).toBe(5)
    expect(result.Items).toBeUndefined()
  })

  it('should throw ValidationException without KeyConditionExpression', async () => {
    await expect(
      client.send(new QueryCommand({ TableName: 'Orders' }))
    ).rejects.toThrow(ValidationException)
  })
})

// ============================================================================
// SCAN TESTS
// ============================================================================

describe('ScanCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'Products',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      })
    )

    // Insert test data
    for (let i = 1; i <= 10; i++) {
      await client.send(
        new PutItemCommand({
          TableName: 'Products',
          Item: {
            id: { S: `PROD#${i}` },
            price: { N: String(i * 10) },
            category: { S: i % 2 === 0 ? 'electronics' : 'books' },
          },
        })
      )
    }
  })

  it('should scan all items', async () => {
    const result = await client.send(new ScanCommand({ TableName: 'Products' }))

    expect(result.Count).toBe(10)
    expect(result.Items).toHaveLength(10)
  })

  it('should scan with filter expression', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'Products',
        FilterExpression: 'category = :cat',
        ExpressionAttributeValues: { ':cat': { S: 'electronics' } },
      })
    )

    expect(result.Count).toBe(5)
  })

  it('should scan with multiple filter conditions', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'Products',
        FilterExpression: 'category = :cat AND price > :minPrice',
        ExpressionAttributeValues: {
          ':cat': { S: 'electronics' },
          ':minPrice': { N: '50' },
        },
      })
    )

    // Electronics with price > 50: 60, 80, 100 (items 6, 8, 10)
    expect(result.Count).toBe(3)
  })

  it('should scan with limit', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'Products',
        Limit: 5,
      })
    )

    expect(result.Count).toBe(5)
  })

  it('should scan with projection', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'Products',
        ProjectionExpression: 'id',
        Limit: 1,
      })
    )

    expect(result.Items![0].id).toBeDefined()
    expect(result.Items![0].price).toBeUndefined()
  })

  it('should scan with SELECT COUNT', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'Products',
        FilterExpression: 'price >= :minPrice',
        ExpressionAttributeValues: { ':minPrice': { N: '50' } },
        Select: 'COUNT',
      })
    )

    expect(result.Count).toBe(6) // Items with price 50, 60, 70, 80, 90, 100
    expect(result.Items).toBeUndefined()
  })
})

// ============================================================================
// BATCH OPERATIONS TESTS
// ============================================================================

describe('BatchWriteItemCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'BatchTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )
  })

  it('should batch put items', async () => {
    const result = await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          BatchTable: [
            { PutRequest: { Item: { pk: { S: 'item1' }, data: { S: 'value1' } } } },
            { PutRequest: { Item: { pk: { S: 'item2' }, data: { S: 'value2' } } } },
            { PutRequest: { Item: { pk: { S: 'item3' }, data: { S: 'value3' } } } },
          ],
        },
      })
    )

    expect(result.$metadata.httpStatusCode).toBe(200)

    const scan = await client.send(new ScanCommand({ TableName: 'BatchTable' }))
    expect(scan.Count).toBe(3)
  })

  it('should batch delete items', async () => {
    // First, put some items
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          BatchTable: [
            { PutRequest: { Item: { pk: { S: 'item1' } } } },
            { PutRequest: { Item: { pk: { S: 'item2' } } } },
            { PutRequest: { Item: { pk: { S: 'item3' } } } },
          ],
        },
      })
    )

    // Then delete some
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          BatchTable: [
            { DeleteRequest: { Key: { pk: { S: 'item1' } } } },
            { DeleteRequest: { Key: { pk: { S: 'item3' } } } },
          ],
        },
      })
    )

    const scan = await client.send(new ScanCommand({ TableName: 'BatchTable' }))
    expect(scan.Count).toBe(1)
    expect(scan.Items![0].pk?.S).toBe('item2')
  })

  it('should mix put and delete in same batch', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'BatchTable',
        Item: { pk: { S: 'existing' } },
      })
    )

    await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          BatchTable: [
            { PutRequest: { Item: { pk: { S: 'new1' } } } },
            { DeleteRequest: { Key: { pk: { S: 'existing' } } } },
            { PutRequest: { Item: { pk: { S: 'new2' } } } },
          ],
        },
      })
    )

    const scan = await client.send(new ScanCommand({ TableName: 'BatchTable' }))
    expect(scan.Count).toBe(2)
  })
})

describe('BatchGetItemCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'BatchTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    for (let i = 1; i <= 5; i++) {
      await client.send(
        new PutItemCommand({
          TableName: 'BatchTable',
          Item: { pk: { S: `item${i}` }, data: { S: `value${i}` } },
        })
      )
    }
  })

  it('should batch get items', async () => {
    const result = await client.send(
      new BatchGetItemCommand({
        RequestItems: {
          BatchTable: {
            Keys: [{ pk: { S: 'item1' } }, { pk: { S: 'item3' } }, { pk: { S: 'item5' } }],
          },
        },
      })
    )

    expect(result.Responses?.BatchTable).toHaveLength(3)
  })

  it('should batch get with projection', async () => {
    const result = await client.send(
      new BatchGetItemCommand({
        RequestItems: {
          BatchTable: {
            Keys: [{ pk: { S: 'item1' } }],
            ProjectionExpression: 'pk',
          },
        },
      })
    )

    expect(result.Responses?.BatchTable?.[0].pk).toBeDefined()
    expect(result.Responses?.BatchTable?.[0].data).toBeUndefined()
  })

  it('should handle non-existent items', async () => {
    const result = await client.send(
      new BatchGetItemCommand({
        RequestItems: {
          BatchTable: {
            Keys: [
              { pk: { S: 'item1' } },
              { pk: { S: 'nonexistent' } },
              { pk: { S: 'item2' } },
            ],
          },
        },
      })
    )

    expect(result.Responses?.BatchTable).toHaveLength(2)
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('TransactGetItemsCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'TransactTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    for (let i = 1; i <= 3; i++) {
      await client.send(
        new PutItemCommand({
          TableName: 'TransactTable',
          Item: { pk: { S: `item${i}` }, data: { S: `value${i}` } },
        })
      )
    }
  })

  it('should transact get multiple items', async () => {
    const result = await client.send(
      new TransactGetItemsCommand({
        TransactItems: [
          { Get: { TableName: 'TransactTable', Key: { pk: { S: 'item1' } } } },
          { Get: { TableName: 'TransactTable', Key: { pk: { S: 'item2' } } } },
        ],
      })
    )

    expect(result.Responses).toHaveLength(2)
    expect(result.Responses?.[0].Item?.pk?.S).toBe('item1')
    expect(result.Responses?.[1].Item?.pk?.S).toBe('item2')
  })

  it('should transact get with projection', async () => {
    const result = await client.send(
      new TransactGetItemsCommand({
        TransactItems: [
          {
            Get: {
              TableName: 'TransactTable',
              Key: { pk: { S: 'item1' } },
              ProjectionExpression: 'pk',
            },
          },
        ],
      })
    )

    expect(result.Responses?.[0].Item?.pk).toBeDefined()
    expect(result.Responses?.[0].Item?.data).toBeUndefined()
  })
})

describe('TransactWriteItemsCommand', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'TransactTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )
  })

  it('should transact write multiple puts', async () => {
    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          { Put: { TableName: 'TransactTable', Item: { pk: { S: 'item1' }, data: { S: 'v1' } } } },
          { Put: { TableName: 'TransactTable', Item: { pk: { S: 'item2' }, data: { S: 'v2' } } } },
        ],
      })
    )

    const scan = await client.send(new ScanCommand({ TableName: 'TransactTable' }))
    expect(scan.Count).toBe(2)
  })

  it('should transact with update and delete', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'TransactTable',
        Item: { pk: { S: 'existing' }, count: { N: '10' } },
      })
    )

    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: 'TransactTable',
              Key: { pk: { S: 'existing' } },
              UpdateExpression: 'SET count = count + :inc',
              ExpressionAttributeValues: { ':inc': { N: '5' } },
            },
          },
          {
            Put: {
              TableName: 'TransactTable',
              Item: { pk: { S: 'new' }, data: { S: 'value' } },
            },
          },
        ],
      })
    )

    const item = await client.send(
      new GetItemCommand({ TableName: 'TransactTable', Key: { pk: { S: 'existing' } } })
    )
    expect(item.Item?.count?.N).toBe('15')
  })

  it('should rollback on condition failure', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'TransactTable',
        Item: { pk: { S: 'item1' }, status: { S: 'active' } },
      })
    )

    await expect(
      client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: 'TransactTable',
                Item: { pk: { S: 'item2' } },
              },
            },
            {
              ConditionCheck: {
                TableName: 'TransactTable',
                Key: { pk: { S: 'item1' } },
                ConditionExpression: 'status = :status',
                ExpressionAttributeValues: { ':status': { S: 'inactive' } },
              },
            },
          ],
        })
      )
    ).rejects.toThrow(TransactionCanceledException)

    // Item2 should not exist because transaction was rolled back
    const result = await client.send(
      new GetItemCommand({ TableName: 'TransactTable', Key: { pk: { S: 'item2' } } })
    )
    expect(result.Item).toBeUndefined()
  })
})

// ============================================================================
// FILTER EXPRESSION TESTS
// ============================================================================

describe('Filter expressions', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'FilterTest',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    await client.send(
      new PutItemCommand({
        TableName: 'FilterTest',
        Item: {
          pk: { S: 'item1' },
          name: { S: 'Alice' },
          age: { N: '30' },
          tags: { SS: ['admin', 'user'] },
          data: { M: { active: { BOOL: true } } },
        },
      })
    )
  })

  it('should filter with attribute_exists', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'attribute_exists(name)',
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with attribute_not_exists', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'attribute_not_exists(missing)',
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with begins_with', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'begins_with(name, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: 'Al' } },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with begins_with empty prefix', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'begins_with(name, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: '' } },
      })
    )
    // Empty prefix should match all items
    expect(result.Count).toBe(1)
  })

  it('should filter with contains', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'contains(name, :substr)',
        ExpressionAttributeValues: { ':substr': { S: 'lic' } },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with contains for sets', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'contains(tags, :tag)',
        ExpressionAttributeValues: { ':tag': { S: 'admin' } },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with BETWEEN', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'age BETWEEN :low AND :high',
        ExpressionAttributeValues: {
          ':low': { N: '25' },
          ':high': { N: '35' },
        },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with IN', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'name IN (:n1, :n2)',
        ExpressionAttributeValues: {
          ':n1': { S: 'Alice' },
          ':n2': { S: 'Bob' },
        },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with AND', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'name = :name AND age = :age',
        ExpressionAttributeValues: {
          ':name': { S: 'Alice' },
          ':age': { N: '30' },
        },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with OR', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'name = :n1 OR name = :n2',
        ExpressionAttributeValues: {
          ':n1': { S: 'Alice' },
          ':n2': { S: 'Bob' },
        },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with NOT', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: 'NOT name = :name',
        ExpressionAttributeValues: { ':name': { S: 'Bob' } },
      })
    )
    expect(result.Count).toBe(1)
  })

  it('should filter with expression attribute names', async () => {
    const result = await client.send(
      new ScanCommand({
        TableName: 'FilterTest',
        FilterExpression: '#n = :name',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':name': { S: 'Alice' } },
      })
    )
    expect(result.Count).toBe(1)
  })
})

// ============================================================================
// UPDATE EXPRESSION TESTS
// ============================================================================

describe('Update expressions', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'UpdateTest',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )
  })

  it('should SET multiple attributes', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'SET a = :a, b = :b',
        ExpressionAttributeValues: {
          ':a': { S: 'valueA' },
          ':b': { N: '100' },
        },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.a?.S).toBe('valueA')
    expect(result.Item?.b?.N).toBe('100')
  })

  it('should REMOVE multiple attributes', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, a: { S: 'a' }, b: { S: 'b' }, c: { S: 'c' } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'REMOVE a, b',
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.a).toBeUndefined()
    expect(result.Item?.b).toBeUndefined()
    expect(result.Item?.c?.S).toBe('c')
  })

  it('should ADD to number', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, count: { N: '10' } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'ADD count :inc',
        ExpressionAttributeValues: { ':inc': { N: '5' } },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.count?.N).toBe('15')
  })

  it('should ADD to string set', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, tags: { SS: ['a', 'b'] } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'ADD tags :newTags',
        ExpressionAttributeValues: { ':newTags': { SS: ['c', 'd'] } },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.tags?.SS).toContain('c')
    expect(result.Item?.tags?.SS).toContain('d')
  })

  it('should DELETE from string set', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, tags: { SS: ['a', 'b', 'c'] } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'DELETE tags :toDelete',
        ExpressionAttributeValues: { ':toDelete': { SS: ['b'] } },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.tags?.SS).not.toContain('b')
    expect(result.Item?.tags?.SS).toContain('a')
    expect(result.Item?.tags?.SS).toContain('c')
  })

  it('should use list_append', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, items: { L: [{ S: 'a' }] } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'SET items = list_append(items, :newItems)',
        ExpressionAttributeValues: {
          ':newItems': { L: [{ S: 'b' }, { S: 'c' }] },
        },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.items?.L).toHaveLength(3)
  })

  it('should combine SET and REMOVE', async () => {
    await client.send(
      new PutItemCommand({
        TableName: 'UpdateTest',
        Item: { pk: { S: 'item1' }, a: { S: 'a' }, b: { S: 'b' } },
      })
    )

    await client.send(
      new UpdateItemCommand({
        TableName: 'UpdateTest',
        Key: { pk: { S: 'item1' } },
        UpdateExpression: 'SET c = :c REMOVE a',
        ExpressionAttributeValues: { ':c': { S: 'c' } },
      })
    )

    const result = await client.send(
      new GetItemCommand({ TableName: 'UpdateTest', Key: { pk: { S: 'item1' } } })
    )
    expect(result.Item?.a).toBeUndefined()
    expect(result.Item?.b?.S).toBe('b')
    expect(result.Item?.c?.S).toBe('c')
  })
})

// ============================================================================
// LIST_APPEND TESTS
// ============================================================================

describe('list_append function', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'ListAppendTest',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )
  })

  describe('appending to existing list', () => {
    it('should append items to an existing list using list_append(attr, :value)', async () => {
      // Setup: Put item with existing list
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'a' }, { S: 'b' }] },
          },
        })
      )

      // Append new items
      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(items, :newItems)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'c' }, { S: 'd' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(4)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
      expect(result.Item?.items?.L?.[1]?.S).toBe('b')
      expect(result.Item?.items?.L?.[2]?.S).toBe('c')
      expect(result.Item?.items?.L?.[3]?.S).toBe('d')
    })

    it('should append a single item to an existing list', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            tags: { L: [{ S: 'tag1' }] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET tags = list_append(tags, :newTag)',
          ExpressionAttributeValues: {
            ':newTag': { L: [{ S: 'tag2' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.tags?.L).toHaveLength(2)
      expect(result.Item?.tags?.L?.[0]?.S).toBe('tag1')
      expect(result.Item?.tags?.L?.[1]?.S).toBe('tag2')
    })
  })

  describe('prepending to existing list', () => {
    it('should prepend items using list_append(:value, attr) where list is second argument', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'c' }, { S: 'd' }] },
          },
        })
      )

      // Prepend: list_append(:newItems, items) - newItems come first
      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(:newItems, items)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'a' }, { S: 'b' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(4)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
      expect(result.Item?.items?.L?.[1]?.S).toBe('b')
      expect(result.Item?.items?.L?.[2]?.S).toBe('c')
      expect(result.Item?.items?.L?.[3]?.S).toBe('d')
    })
  })

  describe('list_append with if_not_exists', () => {
    it('should create list when attribute is missing using if_not_exists with list_append', async () => {
      // Item without a list attribute
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            name: { S: 'test' },
          },
        })
      )

      // Use if_not_exists to initialize the list, then append
      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #list = list_append(if_not_exists(#list, :empty), :newItems)',
          ExpressionAttributeNames: { '#list': 'items' },
          ExpressionAttributeValues: {
            ':empty': { L: [] },
            ':newItems': { L: [{ S: 'first' }, { S: 'second' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(2)
      expect(result.Item?.items?.L?.[0]?.S).toBe('first')
      expect(result.Item?.items?.L?.[1]?.S).toBe('second')
    })

    it('should append to existing list when using if_not_exists and list exists', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'existing' }] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #list = list_append(if_not_exists(#list, :empty), :newItems)',
          ExpressionAttributeNames: { '#list': 'items' },
          ExpressionAttributeValues: {
            ':empty': { L: [] },
            ':newItems': { L: [{ S: 'new' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(2)
      expect(result.Item?.items?.L?.[0]?.S).toBe('existing')
      expect(result.Item?.items?.L?.[1]?.S).toBe('new')
    })
  })

  describe('list_append edge cases', () => {
    it('should handle appending to empty list', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(items, :newItems)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'a' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(1)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
    })

    it('should handle appending empty list to existing list', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'a' }, { S: 'b' }] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(items, :empty)',
          ExpressionAttributeValues: {
            ':empty': { L: [] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(2)
    })

    it('should handle lists with mixed types', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'string' }, { N: '42' }] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(items, :newItems)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ BOOL: true }, { M: { nested: { S: 'value' } } }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(4)
      expect(result.Item?.items?.L?.[0]?.S).toBe('string')
      expect(result.Item?.items?.L?.[1]?.N).toBe('42')
      expect(result.Item?.items?.L?.[2]?.BOOL).toBe(true)
      expect(result.Item?.items?.L?.[3]?.M?.nested?.S).toBe('value')
    })

    it('should handle list_append when attribute does not exist (treats as empty list)', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            name: { S: 'test' },
          },
        })
      )

      // list_append on non-existent attribute should treat it as empty list
      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET items = list_append(items, :newItems)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'a' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(1)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
    })

    it('should work with expression attribute names', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'a' }] },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #i = list_append(#i, :newItems)',
          ExpressionAttributeNames: { '#i': 'items' },
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'b' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(2)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
      expect(result.Item?.items?.L?.[1]?.S).toBe('b')
    })
  })

  describe('list_append with nested attributes', () => {
    it('should append to nested list attribute', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            data: { M: { items: { L: [{ S: 'a' }] } } },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET data.items = list_append(data.items, :newItems)',
          ExpressionAttributeValues: {
            ':newItems': { L: [{ S: 'b' }] },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.data?.M?.items?.L).toHaveLength(2)
      expect(result.Item?.data?.M?.items?.L?.[0]?.S).toBe('a')
      expect(result.Item?.data?.M?.items?.L?.[1]?.S).toBe('b')
    })
  })

  describe('list_append in transactions', () => {
    it('should work in TransactWriteItems', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'ListAppendTest',
          Item: {
            pk: { S: 'item1' },
            items: { L: [{ S: 'a' }] },
          },
        })
      )

      await client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Update: {
                TableName: 'ListAppendTest',
                Key: { pk: { S: 'item1' } },
                UpdateExpression: 'SET items = list_append(items, :newItems)',
                ExpressionAttributeValues: {
                  ':newItems': { L: [{ S: 'b' }] },
                },
              },
            },
          ],
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'ListAppendTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.items?.L).toHaveLength(2)
      expect(result.Item?.items?.L?.[0]?.S).toBe('a')
      expect(result.Item?.items?.L?.[1]?.S).toBe('b')
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  let client: DynamoDBClient

  beforeEach(() => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
  })

  it('should throw ResourceNotFoundException for non-existent table', async () => {
    await expect(
      client.send(new GetItemCommand({ TableName: 'NonExistent', Key: { pk: { S: 'x' } } }))
    ).rejects.toThrow(ResourceNotFoundException)
  })

  it('should throw ResourceInUseException for duplicate table', async () => {
    await client.send(
      new CreateTableCommand({
        TableName: 'DupTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    await expect(
      client.send(
        new CreateTableCommand({
          TableName: 'DupTable',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )
    ).rejects.toThrow(ResourceInUseException)
  })

  it('should throw ConditionalCheckFailedException', async () => {
    await client.send(
      new CreateTableCommand({
        TableName: 'CondTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    await client.send(
      new PutItemCommand({
        TableName: 'CondTable',
        Item: { pk: { S: 'item1' }, status: { S: 'active' } },
      })
    )

    await expect(
      client.send(
        new PutItemCommand({
          TableName: 'CondTable',
          Item: { pk: { S: 'item1' } },
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      )
    ).rejects.toThrow(ConditionalCheckFailedException)
  })

  it('should throw ValidationException for invalid query', async () => {
    await client.send(
      new CreateTableCommand({
        TableName: 'ValidTable',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )

    await expect(
      client.send(new QueryCommand({ TableName: 'ValidTable' }))
    ).rejects.toThrow(ValidationException)
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('Pagination', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
  })

  describe('Query pagination', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'PaginationTest',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'N' },
          ],
        })
      )

      // Insert 25 items
      for (let i = 0; i < 25; i++) {
        await client.send(
          new PutItemCommand({
            TableName: 'PaginationTest',
            Item: {
              pk: { S: 'partition' },
              sk: { N: String(i) },
              data: { S: `item-${i}` },
            },
          })
        )
      }
    })

    it('should return LastEvaluatedKey when Limit is less than total items', async () => {
      const page1 = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 10,
        })
      )

      expect(page1.Items).toHaveLength(10)
      expect(page1.LastEvaluatedKey).toBeDefined()
      expect(page1.LastEvaluatedKey?.pk?.S).toBe('partition')
      expect(page1.LastEvaluatedKey?.sk).toBeDefined()
    })

    it('should not return LastEvaluatedKey when all items returned', async () => {
      const result = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 100, // More than total items
        })
      )

      expect(result.Items).toHaveLength(25)
      expect(result.LastEvaluatedKey).toBeUndefined()
    })

    it('should continue from ExclusiveStartKey', async () => {
      const page1 = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 10,
        })
      )

      expect(page1.Items).toHaveLength(10)
      expect(page1.LastEvaluatedKey).toBeDefined()

      const page2 = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 10,
          ExclusiveStartKey: page1.LastEvaluatedKey,
        })
      )

      expect(page2.Items).toHaveLength(10)
      // First item of page2 should be different from any item in page1
      expect(page2.Items![0].sk?.N).not.toBe(page1.Items![0].sk?.N)
      // page2 should continue right after page1
      const lastPage1Sk = Number(page1.Items![page1.Items!.length - 1].sk?.N)
      const firstPage2Sk = Number(page2.Items![0].sk?.N)
      expect(firstPage2Sk).toBe(lastPage1Sk + 1)
    })

    it('should iterate through all items with pagination', async () => {
      const allItems: any[] = []
      let lastKey: any = undefined

      do {
        const result = await client.send(
          new QueryCommand({
            TableName: 'PaginationTest',
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': { S: 'partition' } },
            Limit: 7, // Use odd number to test partial pages
            ExclusiveStartKey: lastKey,
          })
        )

        allItems.push(...result.Items!)
        lastKey = result.LastEvaluatedKey
      } while (lastKey)

      expect(allItems).toHaveLength(25)

      // Verify no duplicates
      const skValues = allItems.map((item) => item.sk?.N)
      const uniqueSkValues = new Set(skValues)
      expect(uniqueSkValues.size).toBe(25)
    })

    it('should paginate in descending order', async () => {
      const page1 = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 10,
          ScanIndexForward: false,
        })
      )

      expect(page1.Items).toHaveLength(10)
      expect(page1.Items![0].sk?.N).toBe('24') // Highest value first
      expect(page1.LastEvaluatedKey).toBeDefined()

      const page2 = await client.send(
        new QueryCommand({
          TableName: 'PaginationTest',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition' } },
          Limit: 10,
          ScanIndexForward: false,
          ExclusiveStartKey: page1.LastEvaluatedKey,
        })
      )

      expect(page2.Items).toHaveLength(10)
      // Should continue in descending order
      const lastPage1Sk = Number(page1.Items![page1.Items!.length - 1].sk?.N)
      const firstPage2Sk = Number(page2.Items![0].sk?.N)
      expect(firstPage2Sk).toBe(lastPage1Sk - 1)
    })
  })

  describe('Scan pagination', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'ScanPaginationTest',
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        })
      )

      // Insert 25 items
      for (let i = 0; i < 25; i++) {
        await client.send(
          new PutItemCommand({
            TableName: 'ScanPaginationTest',
            Item: {
              id: { S: `item-${String(i).padStart(3, '0')}` },
              data: { S: `data-${i}` },
            },
          })
        )
      }
    })

    it('should return LastEvaluatedKey when Limit is less than total items', async () => {
      const page1 = await client.send(
        new ScanCommand({
          TableName: 'ScanPaginationTest',
          Limit: 10,
        })
      )

      expect(page1.Items).toHaveLength(10)
      expect(page1.LastEvaluatedKey).toBeDefined()
      expect(page1.LastEvaluatedKey?.id).toBeDefined()
    })

    it('should continue from ExclusiveStartKey', async () => {
      const page1 = await client.send(
        new ScanCommand({
          TableName: 'ScanPaginationTest',
          Limit: 10,
        })
      )

      expect(page1.Items).toHaveLength(10)
      expect(page1.LastEvaluatedKey).toBeDefined()

      const page2 = await client.send(
        new ScanCommand({
          TableName: 'ScanPaginationTest',
          Limit: 10,
          ExclusiveStartKey: page1.LastEvaluatedKey,
        })
      )

      expect(page2.Items).toHaveLength(10)

      // Ensure no overlap between pages
      const page1Ids = new Set(page1.Items!.map((item) => item.id?.S))
      const page2Ids = page2.Items!.map((item) => item.id?.S)
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false)
      }
    })

    it('should iterate through all items with pagination', async () => {
      const allItems: any[] = []
      let lastKey: any = undefined

      do {
        const result = await client.send(
          new ScanCommand({
            TableName: 'ScanPaginationTest',
            Limit: 7,
            ExclusiveStartKey: lastKey,
          })
        )

        allItems.push(...result.Items!)
        lastKey = result.LastEvaluatedKey
      } while (lastKey)

      expect(allItems).toHaveLength(25)

      // Verify no duplicates
      const ids = allItems.map((item) => item.id?.S)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(25)
    })
  })

  describe('Pagination with hash-only key', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'HashOnlyPagination',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        })
      )

      // Insert items
      for (let i = 0; i < 15; i++) {
        await client.send(
          new PutItemCommand({
            TableName: 'HashOnlyPagination',
            Item: {
              pk: { S: `item-${String(i).padStart(3, '0')}` },
              data: { S: `data-${i}` },
            },
          })
        )
      }
    })

    it('should paginate scan with hash-only key', async () => {
      const page1 = await client.send(
        new ScanCommand({
          TableName: 'HashOnlyPagination',
          Limit: 5,
        })
      )

      expect(page1.Items).toHaveLength(5)
      expect(page1.LastEvaluatedKey).toBeDefined()
      expect(page1.LastEvaluatedKey?.pk).toBeDefined()

      const page2 = await client.send(
        new ScanCommand({
          TableName: 'HashOnlyPagination',
          Limit: 5,
          ExclusiveStartKey: page1.LastEvaluatedKey,
        })
      )

      expect(page2.Items).toHaveLength(5)

      // No overlap
      const page1Pks = new Set(page1.Items!.map((item) => item.pk?.S))
      for (const item of page2.Items!) {
        expect(page1Pks.has(item.pk?.S)).toBe(false)
      }
    })
  })
})

// ============================================================================
// SCANNED COUNT TESTS
// ============================================================================

describe('ScannedCount behavior', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
  })

  describe('Query ScannedCount', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'TestTable',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
        })
      )

      // Insert 10 items, 5 with status=active, 5 with status=inactive
      for (let i = 0; i < 10; i++) {
        await client.send(
          new PutItemCommand({
            TableName: 'TestTable',
            Item: {
              pk: { S: 'partition1' },
              sk: { S: `item#${String(i).padStart(3, '0')}` },
              status: { S: i < 5 ? 'active' : 'inactive' },
              value: { N: String(i * 10) },
            },
          })
        )
      }
    })

    it('should have ScannedCount equal to Count when no FilterExpression', async () => {
      const result = await client.send(
        new QueryCommand({
          TableName: 'TestTable',
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': { S: 'partition1' } },
        })
      )

      expect(result.Count).toBe(10)
      expect(result.ScannedCount).toBe(10)
      expect(result.Count).toBe(result.ScannedCount)
    })

    it('should have ScannedCount > Count when FilterExpression filters items', async () => {
      const result = await client.send(
        new QueryCommand({
          TableName: 'TestTable',
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :status',
          ExpressionAttributeValues: {
            ':pk': { S: 'partition1' },
            ':status': { S: 'active' },
          },
        })
      )

      // 5 items match the filter, but 10 items were scanned
      expect(result.Count).toBe(5)
      expect(result.ScannedCount).toBe(10)
      expect(result.ScannedCount).toBeGreaterThan(result.Count!)
    })

    it('should have ScannedCount respect Limit parameter (applied before filter)', async () => {
      // AWS DynamoDB: Limit is applied before FilterExpression
      // So if Limit=3, we scan 3 items, then filter, and return what matches
      const result = await client.send(
        new QueryCommand({
          TableName: 'TestTable',
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :status',
          ExpressionAttributeValues: {
            ':pk': { S: 'partition1' },
            ':status': { S: 'active' },
          },
          Limit: 3,
        })
      )

      // With Limit=3, we scan 3 items (items 0, 1, 2 which are all active)
      // All 3 match the filter, so Count=3, ScannedCount=3
      expect(result.ScannedCount).toBe(3)
      expect(result.Count).toBe(3)
    })

    it('should have ScannedCount reflect items examined when Limit excludes filtered items', async () => {
      // Start from item 3 (which is active), scan 5 items (items 3, 4, 5, 6, 7)
      // Items 3, 4 are active, items 5, 6, 7 are inactive
      const result = await client.send(
        new QueryCommand({
          TableName: 'TestTable',
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :status',
          ExpressionAttributeValues: {
            ':pk': { S: 'partition1' },
            ':status': { S: 'active' },
          },
          Limit: 5,
          ExclusiveStartKey: {
            pk: { S: 'partition1' },
            sk: { S: 'item#002' }, // Start after item 2
          },
        })
      )

      // Scanned 5 items (3, 4, 5, 6, 7), but only items 3, 4 are active
      expect(result.ScannedCount).toBe(5)
      expect(result.Count).toBe(2)
    })

    it('should return correct ScannedCount with SELECT COUNT', async () => {
      const result = await client.send(
        new QueryCommand({
          TableName: 'TestTable',
          KeyConditionExpression: 'pk = :pk',
          FilterExpression: 'status = :status',
          ExpressionAttributeValues: {
            ':pk': { S: 'partition1' },
            ':status': { S: 'inactive' },
          },
          Select: 'COUNT',
        })
      )

      expect(result.Count).toBe(5) // 5 inactive items
      expect(result.ScannedCount).toBe(10) // All 10 items scanned
      expect(result.Items).toBeUndefined()
    })
  })

  describe('Scan ScannedCount', () => {
    beforeEach(async () => {
      await client.send(
        new CreateTableCommand({
          TableName: 'ScanTestTable',
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        })
      )

      // Insert 20 items, half with category=books, half with category=electronics
      for (let i = 0; i < 20; i++) {
        await client.send(
          new PutItemCommand({
            TableName: 'ScanTestTable',
            Item: {
              id: { S: `item#${String(i).padStart(3, '0')}` },
              category: { S: i < 10 ? 'books' : 'electronics' },
              price: { N: String(i * 5) },
            },
          })
        )
      }
    })

    it('should have ScannedCount equal to Count when no FilterExpression', async () => {
      const result = await client.send(
        new ScanCommand({
          TableName: 'ScanTestTable',
        })
      )

      expect(result.Count).toBe(20)
      expect(result.ScannedCount).toBe(20)
      expect(result.Count).toBe(result.ScannedCount)
    })

    it('should have ScannedCount > Count when FilterExpression filters items', async () => {
      const result = await client.send(
        new ScanCommand({
          TableName: 'ScanTestTable',
          FilterExpression: 'category = :cat',
          ExpressionAttributeValues: { ':cat': { S: 'books' } },
        })
      )

      // 10 items match the filter, but 20 items were scanned
      expect(result.Count).toBe(10)
      expect(result.ScannedCount).toBe(20)
      expect(result.ScannedCount).toBeGreaterThan(result.Count!)
    })

    it('should have ScannedCount respect Limit parameter (applied before filter)', async () => {
      // With Limit=5, we only scan 5 items before applying the filter
      const result = await client.send(
        new ScanCommand({
          TableName: 'ScanTestTable',
          FilterExpression: 'category = :cat',
          ExpressionAttributeValues: { ':cat': { S: 'books' } },
          Limit: 5,
        })
      )

      // Scanned 5 items, and since books are items 0-9 (first in sort order),
      // all 5 should match
      expect(result.ScannedCount).toBe(5)
      expect(result.Count).toBeLessThanOrEqual(5)
    })

    it('should return correct ScannedCount with SELECT COUNT', async () => {
      const result = await client.send(
        new ScanCommand({
          TableName: 'ScanTestTable',
          FilterExpression: 'price >= :minPrice',
          ExpressionAttributeValues: { ':minPrice': { N: '50' } },
          Select: 'COUNT',
        })
      )

      // Items with price >= 50 are items 10-19 (price 50, 55, ..., 95)
      expect(result.Count).toBe(10)
      expect(result.ScannedCount).toBe(20) // All items scanned
      expect(result.Items).toBeUndefined()
    })

    it('should accumulate correct ScannedCount across paginated scans', async () => {
      let totalScanned = 0
      let totalCount = 0
      let lastKey: any = undefined

      do {
        const result = await client.send(
          new ScanCommand({
            TableName: 'ScanTestTable',
            FilterExpression: 'category = :cat',
            ExpressionAttributeValues: { ':cat': { S: 'electronics' } },
            Limit: 7,
            ExclusiveStartKey: lastKey,
          })
        )

        totalScanned += result.ScannedCount ?? 0
        totalCount += result.Count ?? 0
        lastKey = result.LastEvaluatedKey
      } while (lastKey)

      // Total scanned should be 20 (all items)
      // Total count should be 10 (electronics items)
      expect(totalScanned).toBe(20)
      expect(totalCount).toBe(10)
    })
  })
})

// ============================================================================
// IF_NOT_EXISTS FUNCTION TESTS
// ============================================================================

describe('if_not_exists function', () => {
  let client: DynamoDBClient

  beforeEach(async () => {
    clearAllTables()
    client = new DynamoDBClient({ region: 'us-east-1' })
    await client.send(
      new CreateTableCommand({
        TableName: 'IfNotExistsTest',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      })
    )
  })

  describe('basic if_not_exists usage', () => {
    it('should set value when attribute is missing', async () => {
      // Item without the 'status' attribute
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            name: { S: 'test' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #status = if_not_exists(#status, :default)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':default': { S: 'active' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.status?.S).toBe('active')
    })

    it('should preserve value when attribute exists', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            status: { S: 'inactive' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #status = if_not_exists(#status, :default)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':default': { S: 'active' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      // Should preserve existing 'inactive' value
      expect(result.Item?.status?.S).toBe('inactive')
    })

    it('should work with different attribute types', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
          },
        })
      )

      // Set number with if_not_exists
      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET counter = if_not_exists(counter, :zero)',
          ExpressionAttributeValues: { ':zero': { N: '0' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.counter?.N).toBe('0')
    })
  })

  describe('if_not_exists with arithmetic (counter pattern)', () => {
    it('should initialize counter and add when attribute is missing', async () => {
      // Item without a counter attribute
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            name: { S: 'test' },
          },
        })
      )

      // Common counter pattern: SET counter = if_not_exists(counter, :zero) + :inc
      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #counter = if_not_exists(#counter, :zero) + :inc',
          ExpressionAttributeNames: { '#counter': 'counter' },
          ExpressionAttributeValues: {
            ':zero': { N: '0' },
            ':inc': { N: '1' },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      // Counter should be 0 + 1 = 1
      expect(result.Item?.counter?.N).toBe('1')
    })

    it('should increment existing counter when attribute exists', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            counter: { N: '10' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET #counter = if_not_exists(#counter, :zero) + :inc',
          ExpressionAttributeNames: { '#counter': 'counter' },
          ExpressionAttributeValues: {
            ':zero': { N: '0' },
            ':inc': { N: '1' },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      // Counter should be 10 + 1 = 11
      expect(result.Item?.counter?.N).toBe('11')
    })

    it('should support subtraction with if_not_exists', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET balance = if_not_exists(balance, :start) - :dec',
          ExpressionAttributeValues: {
            ':start': { N: '100' },
            ':dec': { N: '10' },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      // Balance should be 100 - 10 = 90
      expect(result.Item?.balance?.N).toBe('90')
    })

    it('should handle multiple if_not_exists with arithmetic in one expression', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            views: { N: '5' }, // Only views exists, visits does not
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET views = if_not_exists(views, :zero) + :inc, visits = if_not_exists(visits, :zero) + :inc',
          ExpressionAttributeValues: {
            ':zero': { N: '0' },
            ':inc': { N: '1' },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      // views: 5 + 1 = 6, visits: 0 + 1 = 1
      expect(result.Item?.views?.N).toBe('6')
      expect(result.Item?.visits?.N).toBe('1')
    })
  })

  describe('if_not_exists for item creation', () => {
    it('should initialize all fields when item does not exist', async () => {
      // Update on non-existent item - should create it
      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'newitem' } },
          UpdateExpression: 'SET #counter = if_not_exists(#counter, :zero) + :inc, #status = if_not_exists(#status, :default)',
          ExpressionAttributeNames: {
            '#counter': 'counter',
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':zero': { N: '0' },
            ':inc': { N: '1' },
            ':default': { S: 'active' },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'newitem' } },
        })
      )

      expect(result.Item?.pk?.S).toBe('newitem')
      expect(result.Item?.counter?.N).toBe('1')
      expect(result.Item?.status?.S).toBe('active')
    })
  })

  describe('if_not_exists edge cases', () => {
    it('should handle nested paths', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
            data: { M: { name: { S: 'test' } } },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET data.count = if_not_exists(data.count, :zero)',
          ExpressionAttributeValues: { ':zero': { N: '0' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.data?.M?.count?.N).toBe('0')
    })

    it('should handle if_not_exists where path references different attribute than target', async () => {
      // SET newAttr = if_not_exists(oldAttr, :default)
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET newStatus = if_not_exists(oldStatus, :default)',
          ExpressionAttributeValues: { ':default': { S: 'pending' } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.newStatus?.S).toBe('pending')
      expect(result.Item?.oldStatus).toBeUndefined()
    })

    it('should work with boolean values', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET active = if_not_exists(active, :default)',
          ExpressionAttributeValues: { ':default': { BOOL: true } },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.active?.BOOL).toBe(true)
    })

    it('should work with map values', async () => {
      await client.send(
        new PutItemCommand({
          TableName: 'IfNotExistsTest',
          Item: {
            pk: { S: 'item1' },
          },
        })
      )

      await client.send(
        new UpdateItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
          UpdateExpression: 'SET metadata = if_not_exists(metadata, :default)',
          ExpressionAttributeValues: {
            ':default': { M: { created: { S: '2025-01-01' }, version: { N: '1' } } },
          },
        })
      )

      const result = await client.send(
        new GetItemCommand({
          TableName: 'IfNotExistsTest',
          Key: { pk: { S: 'item1' } },
        })
      )

      expect(result.Item?.metadata?.M?.created?.S).toBe('2025-01-01')
      expect(result.Item?.metadata?.M?.version?.N).toBe('1')
    })
  })
})
