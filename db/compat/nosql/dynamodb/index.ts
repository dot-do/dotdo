/**
 * @dotdo/dynamodb
 *
 * AWS DynamoDB SDK-compatible compat layer for Durable Objects.
 *
 * Drop-in replacement for @aws-sdk/client-dynamodb backed by DO SQLite storage.
 * Supports table operations, item CRUD, queries, scans, batch operations, and transactions.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/
 *
 * @example
 * ```typescript
 * import { DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand } from '@dotdo/dynamodb'
 *
 * const client = new DynamoDBClient({ region: 'us-east-1' })
 *
 * // Create a table
 * await client.send(new CreateTableCommand({
 *   TableName: 'Users',
 *   KeySchema: [
 *     { AttributeName: 'pk', KeyType: 'HASH' },
 *     { AttributeName: 'sk', KeyType: 'RANGE' }
 *   ],
 *   AttributeDefinitions: [
 *     { AttributeName: 'pk', AttributeType: 'S' },
 *     { AttributeName: 'sk', AttributeType: 'S' }
 *   ]
 * }))
 *
 * // Put an item
 * await client.send(new PutItemCommand({
 *   TableName: 'Users',
 *   Item: {
 *     pk: { S: 'USER#123' },
 *     sk: { S: 'PROFILE' },
 *     name: { S: 'Alice' },
 *     age: { N: '30' }
 *   }
 * }))
 *
 * // Get an item
 * const result = await client.send(new GetItemCommand({
 *   TableName: 'Users',
 *   Key: {
 *     pk: { S: 'USER#123' },
 *     sk: { S: 'PROFILE' }
 *   }
 * }))
 * console.log(result.Item)
 * ```
 */

// Export client
export { DynamoDBClient, createClient, clearAllTables } from './dynamodb'

// Export commands
export {
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
} from './dynamodb'

// Export errors
export {
  DynamoDBServiceException,
  ResourceNotFoundException,
  ResourceInUseException,
  ConditionalCheckFailedException,
  TransactionCanceledException,
  ValidationException,
  ProvisionedThroughputExceededException,
  ItemCollectionSizeLimitExceededException,
} from './dynamodb'

// Export marshalling utilities
export { marshall, marshallItem, unmarshall, unmarshallItem } from './dynamodb'

// Export types
export type {
  AttributeValue,
  Key,
  Item,
  KeyType,
  KeySchemaElement,
  ScalarAttributeType,
  AttributeDefinition,
  ProvisionedThroughput,
  ProvisionedThroughputDescription,
  BillingMode,
  BillingModeSummary,
  TableStatus,
  ProjectionType,
  Projection,
  LocalSecondaryIndex,
  LocalSecondaryIndexDescription,
  GlobalSecondaryIndex,
  GlobalSecondaryIndexDescription,
  IndexStatus,
  StreamViewType,
  StreamSpecification,
  TableDescription,
  Tag,
  ReturnValue,
  ReturnConsumedCapacity,
  ReturnItemCollectionMetrics,
  ConditionalOperator,
  ConsumedCapacity,
  Capacity,
  ItemCollectionMetrics,
  Select,
  WriteRequest,
  PutRequest,
  DeleteRequest,
  KeysAndAttributes,
  Get,
  TransactGetItem,
  Put,
  Delete,
  Update,
  ConditionCheck,
  TransactWriteItem,
  ItemResponse,
  CancellationReason,
  ResponseMetadata,
  Credentials,
  DynamoDBClientConfig,
  ExtendedDynamoDBClientConfig,
  Command,
  DynamoDBClient as IDynamoDBClient,
  // Command inputs
  CreateTableCommandInput,
  CreateTableCommandOutput,
  DeleteTableCommandInput,
  DeleteTableCommandOutput,
  DescribeTableCommandInput,
  DescribeTableCommandOutput,
  ListTablesCommandInput,
  ListTablesCommandOutput,
  PutItemCommandInput,
  PutItemCommandOutput,
  GetItemCommandInput,
  GetItemCommandOutput,
  UpdateItemCommandInput,
  UpdateItemCommandOutput,
  DeleteItemCommandInput,
  DeleteItemCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommandInput,
  ScanCommandOutput,
  BatchWriteItemCommandInput,
  BatchWriteItemCommandOutput,
  BatchGetItemCommandInput,
  BatchGetItemCommandOutput,
  TransactGetItemsCommandInput,
  TransactGetItemsCommandOutput,
  TransactWriteItemsCommandInput,
  TransactWriteItemsCommandOutput,
} from './types'
