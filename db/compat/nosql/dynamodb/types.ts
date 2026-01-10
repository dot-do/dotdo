/**
 * @dotdo/dynamodb types
 *
 * AWS DynamoDB SDK-compatible type definitions
 * for the DynamoDB SDK backed by Durable Objects with SQLite storage
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/
 */

/// <reference types="@cloudflare/workers-types" />

// ============================================================================
// ATTRIBUTE VALUE TYPES
// ============================================================================

/**
 * DynamoDB Attribute Value
 * This is the core type for all DynamoDB data
 */
export interface AttributeValue {
  /** String type */
  S?: string
  /** Number type (stored as string for precision) */
  N?: string
  /** Binary type (base64 encoded) */
  B?: Uint8Array
  /** String Set type */
  SS?: string[]
  /** Number Set type */
  NS?: string[]
  /** Binary Set type */
  BS?: Uint8Array[]
  /** Map type */
  M?: Record<string, AttributeValue>
  /** List type */
  L?: AttributeValue[]
  /** Null type */
  NULL?: boolean
  /** Boolean type */
  BOOL?: boolean
}

/**
 * Key type for DynamoDB items (partition key + optional sort key)
 */
export type Key = Record<string, AttributeValue>

/**
 * Item type for DynamoDB
 */
export type Item = Record<string, AttributeValue>

// ============================================================================
// KEY SCHEMA AND ATTRIBUTES
// ============================================================================

/**
 * Key type enum
 */
export type KeyType = 'HASH' | 'RANGE'

/**
 * Key schema element
 */
export interface KeySchemaElement {
  AttributeName: string
  KeyType: KeyType
}

/**
 * Scalar attribute type
 */
export type ScalarAttributeType = 'S' | 'N' | 'B'

/**
 * Attribute definition
 */
export interface AttributeDefinition {
  AttributeName: string
  AttributeType: ScalarAttributeType
}

// ============================================================================
// PROVISIONED THROUGHPUT
// ============================================================================

/**
 * Provisioned throughput configuration
 */
export interface ProvisionedThroughput {
  ReadCapacityUnits: number
  WriteCapacityUnits: number
}

/**
 * Provisioned throughput description
 */
export interface ProvisionedThroughputDescription {
  LastIncreaseDateTime?: Date
  LastDecreaseDateTime?: Date
  NumberOfDecreasesToday?: number
  ReadCapacityUnits?: number
  WriteCapacityUnits?: number
}

// ============================================================================
// BILLING MODE
// ============================================================================

/**
 * Billing mode
 */
export type BillingMode = 'PROVISIONED' | 'PAY_PER_REQUEST'

/**
 * Billing mode summary
 */
export interface BillingModeSummary {
  BillingMode?: BillingMode
  LastUpdateToPayPerRequestDateTime?: Date
}

// ============================================================================
// TABLE STATUS
// ============================================================================

/**
 * Table status enum
 */
export type TableStatus =
  | 'CREATING'
  | 'UPDATING'
  | 'DELETING'
  | 'ACTIVE'
  | 'INACCESSIBLE_ENCRYPTION_CREDENTIALS'
  | 'ARCHIVING'
  | 'ARCHIVED'

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Projection type
 */
export type ProjectionType = 'ALL' | 'KEYS_ONLY' | 'INCLUDE'

/**
 * Projection configuration
 */
export interface Projection {
  ProjectionType?: ProjectionType
  NonKeyAttributes?: string[]
}

/**
 * Local secondary index
 */
export interface LocalSecondaryIndex {
  IndexName: string
  KeySchema: KeySchemaElement[]
  Projection: Projection
}

/**
 * Local secondary index description
 */
export interface LocalSecondaryIndexDescription {
  IndexName?: string
  KeySchema?: KeySchemaElement[]
  Projection?: Projection
  IndexSizeBytes?: number
  ItemCount?: number
  IndexArn?: string
}

/**
 * Global secondary index
 */
export interface GlobalSecondaryIndex {
  IndexName: string
  KeySchema: KeySchemaElement[]
  Projection: Projection
  ProvisionedThroughput?: ProvisionedThroughput
}

/**
 * Global secondary index status
 */
export type IndexStatus = 'CREATING' | 'UPDATING' | 'DELETING' | 'ACTIVE'

/**
 * Global secondary index description
 */
export interface GlobalSecondaryIndexDescription {
  IndexName?: string
  KeySchema?: KeySchemaElement[]
  Projection?: Projection
  IndexStatus?: IndexStatus
  Backfilling?: boolean
  ProvisionedThroughput?: ProvisionedThroughputDescription
  IndexSizeBytes?: number
  ItemCount?: number
  IndexArn?: string
}

// ============================================================================
// TABLE DESCRIPTION
// ============================================================================

/**
 * Stream view type
 */
export type StreamViewType = 'KEYS_ONLY' | 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES'

/**
 * Stream specification
 */
export interface StreamSpecification {
  StreamEnabled: boolean
  StreamViewType?: StreamViewType
}

/**
 * Table description
 */
export interface TableDescription {
  TableName?: string
  TableStatus?: TableStatus
  CreationDateTime?: Date
  KeySchema?: KeySchemaElement[]
  AttributeDefinitions?: AttributeDefinition[]
  ProvisionedThroughput?: ProvisionedThroughputDescription
  TableSizeBytes?: number
  ItemCount?: number
  TableArn?: string
  TableId?: string
  BillingModeSummary?: BillingModeSummary
  LocalSecondaryIndexes?: LocalSecondaryIndexDescription[]
  GlobalSecondaryIndexes?: GlobalSecondaryIndexDescription[]
  StreamSpecification?: StreamSpecification
  LatestStreamLabel?: string
  LatestStreamArn?: string
}

// ============================================================================
// COMMAND INPUTS
// ============================================================================

/**
 * CreateTable command input
 */
export interface CreateTableCommandInput {
  TableName: string
  KeySchema: KeySchemaElement[]
  AttributeDefinitions: AttributeDefinition[]
  ProvisionedThroughput?: ProvisionedThroughput
  BillingMode?: BillingMode
  LocalSecondaryIndexes?: LocalSecondaryIndex[]
  GlobalSecondaryIndexes?: GlobalSecondaryIndex[]
  StreamSpecification?: StreamSpecification
  Tags?: Tag[]
}

/**
 * Tag type
 */
export interface Tag {
  Key: string
  Value: string
}

/**
 * CreateTable command output
 */
export interface CreateTableCommandOutput {
  TableDescription?: TableDescription
  $metadata: ResponseMetadata
}

/**
 * DeleteTable command input
 */
export interface DeleteTableCommandInput {
  TableName: string
}

/**
 * DeleteTable command output
 */
export interface DeleteTableCommandOutput {
  TableDescription?: TableDescription
  $metadata: ResponseMetadata
}

/**
 * DescribeTable command input
 */
export interface DescribeTableCommandInput {
  TableName: string
}

/**
 * DescribeTable command output
 */
export interface DescribeTableCommandOutput {
  Table?: TableDescription
  $metadata: ResponseMetadata
}

/**
 * ListTables command input
 */
export interface ListTablesCommandInput {
  ExclusiveStartTableName?: string
  Limit?: number
}

/**
 * ListTables command output
 */
export interface ListTablesCommandOutput {
  TableNames?: string[]
  LastEvaluatedTableName?: string
  $metadata: ResponseMetadata
}

// ============================================================================
// ITEM OPERATIONS
// ============================================================================

/**
 * Return values enum
 */
export type ReturnValue = 'NONE' | 'ALL_OLD' | 'UPDATED_OLD' | 'ALL_NEW' | 'UPDATED_NEW'

/**
 * Return consumed capacity enum
 */
export type ReturnConsumedCapacity = 'INDEXES' | 'TOTAL' | 'NONE'

/**
 * Return item collection metrics enum
 */
export type ReturnItemCollectionMetrics = 'SIZE' | 'NONE'

/**
 * Conditional operator enum
 */
export type ConditionalOperator = 'AND' | 'OR'

/**
 * Consumed capacity
 */
export interface ConsumedCapacity {
  TableName?: string
  CapacityUnits?: number
  ReadCapacityUnits?: number
  WriteCapacityUnits?: number
  Table?: Capacity
  LocalSecondaryIndexes?: Record<string, Capacity>
  GlobalSecondaryIndexes?: Record<string, Capacity>
}

/**
 * Capacity
 */
export interface Capacity {
  ReadCapacityUnits?: number
  WriteCapacityUnits?: number
  CapacityUnits?: number
}

/**
 * Item collection metrics
 */
export interface ItemCollectionMetrics {
  ItemCollectionKey?: Record<string, AttributeValue>
  SizeEstimateRangeGB?: number[]
}

/**
 * PutItem command input
 */
export interface PutItemCommandInput {
  TableName: string
  Item: Item
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValues?: ReturnValue
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  ReturnItemCollectionMetrics?: ReturnItemCollectionMetrics
}

/**
 * PutItem command output
 */
export interface PutItemCommandOutput {
  Attributes?: Item
  ConsumedCapacity?: ConsumedCapacity
  ItemCollectionMetrics?: ItemCollectionMetrics
  $metadata: ResponseMetadata
}

/**
 * GetItem command input
 */
export interface GetItemCommandInput {
  TableName: string
  Key: Key
  ProjectionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ConsistentRead?: boolean
  ReturnConsumedCapacity?: ReturnConsumedCapacity
}

/**
 * GetItem command output
 */
export interface GetItemCommandOutput {
  Item?: Item
  ConsumedCapacity?: ConsumedCapacity
  $metadata: ResponseMetadata
}

/**
 * UpdateItem command input
 */
export interface UpdateItemCommandInput {
  TableName: string
  Key: Key
  UpdateExpression?: string
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValues?: ReturnValue
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  ReturnItemCollectionMetrics?: ReturnItemCollectionMetrics
}

/**
 * UpdateItem command output
 */
export interface UpdateItemCommandOutput {
  Attributes?: Item
  ConsumedCapacity?: ConsumedCapacity
  ItemCollectionMetrics?: ItemCollectionMetrics
  $metadata: ResponseMetadata
}

/**
 * DeleteItem command input
 */
export interface DeleteItemCommandInput {
  TableName: string
  Key: Key
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValues?: ReturnValue
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  ReturnItemCollectionMetrics?: ReturnItemCollectionMetrics
}

/**
 * DeleteItem command output
 */
export interface DeleteItemCommandOutput {
  Attributes?: Item
  ConsumedCapacity?: ConsumedCapacity
  ItemCollectionMetrics?: ItemCollectionMetrics
  $metadata: ResponseMetadata
}

// ============================================================================
// QUERY AND SCAN
// ============================================================================

/**
 * Select enum
 */
export type Select = 'ALL_ATTRIBUTES' | 'ALL_PROJECTED_ATTRIBUTES' | 'SPECIFIC_ATTRIBUTES' | 'COUNT'

/**
 * Query command input
 */
export interface QueryCommandInput {
  TableName: string
  IndexName?: string
  KeyConditionExpression?: string
  FilterExpression?: string
  ProjectionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  Select?: Select
  Limit?: number
  ExclusiveStartKey?: Key
  ScanIndexForward?: boolean
  ConsistentRead?: boolean
  ReturnConsumedCapacity?: ReturnConsumedCapacity
}

/**
 * Query command output
 */
export interface QueryCommandOutput {
  Items?: Item[]
  Count?: number
  ScannedCount?: number
  LastEvaluatedKey?: Key
  ConsumedCapacity?: ConsumedCapacity
  $metadata: ResponseMetadata
}

/**
 * Scan command input
 */
export interface ScanCommandInput {
  TableName: string
  IndexName?: string
  FilterExpression?: string
  ProjectionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  Select?: Select
  Limit?: number
  ExclusiveStartKey?: Key
  ConsistentRead?: boolean
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  Segment?: number
  TotalSegments?: number
}

/**
 * Scan command output
 */
export interface ScanCommandOutput {
  Items?: Item[]
  Count?: number
  ScannedCount?: number
  LastEvaluatedKey?: Key
  ConsumedCapacity?: ConsumedCapacity
  $metadata: ResponseMetadata
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Write request
 */
export interface WriteRequest {
  PutRequest?: PutRequest
  DeleteRequest?: DeleteRequest
}

/**
 * Put request
 */
export interface PutRequest {
  Item: Item
}

/**
 * Delete request
 */
export interface DeleteRequest {
  Key: Key
}

/**
 * BatchWriteItem command input
 */
export interface BatchWriteItemCommandInput {
  RequestItems: Record<string, WriteRequest[]>
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  ReturnItemCollectionMetrics?: ReturnItemCollectionMetrics
}

/**
 * BatchWriteItem command output
 */
export interface BatchWriteItemCommandOutput {
  UnprocessedItems?: Record<string, WriteRequest[]>
  ItemCollectionMetrics?: Record<string, ItemCollectionMetrics[]>
  ConsumedCapacity?: ConsumedCapacity[]
  $metadata: ResponseMetadata
}

/**
 * Keys and attributes
 */
export interface KeysAndAttributes {
  Keys: Key[]
  ProjectionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ConsistentRead?: boolean
}

/**
 * BatchGetItem command input
 */
export interface BatchGetItemCommandInput {
  RequestItems: Record<string, KeysAndAttributes>
  ReturnConsumedCapacity?: ReturnConsumedCapacity
}

/**
 * BatchGetItem command output
 */
export interface BatchGetItemCommandOutput {
  Responses?: Record<string, Item[]>
  UnprocessedKeys?: Record<string, KeysAndAttributes>
  ConsumedCapacity?: ConsumedCapacity[]
  $metadata: ResponseMetadata
}

// ============================================================================
// TRANSACT OPERATIONS
// ============================================================================

/**
 * Get transaction item
 */
export interface Get {
  TableName: string
  Key: Key
  ProjectionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
}

/**
 * TransactGet item
 */
export interface TransactGetItem {
  Get: Get
}

/**
 * TransactGetItems command input
 */
export interface TransactGetItemsCommandInput {
  TransactItems: TransactGetItem[]
  ReturnConsumedCapacity?: ReturnConsumedCapacity
}

/**
 * Item response
 */
export interface ItemResponse {
  Item?: Item
}

/**
 * TransactGetItems command output
 */
export interface TransactGetItemsCommandOutput {
  Responses?: ItemResponse[]
  ConsumedCapacity?: ConsumedCapacity[]
  $metadata: ResponseMetadata
}

/**
 * Put transaction item
 */
export interface Put {
  TableName: string
  Item: Item
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValuesOnConditionCheckFailure?: ReturnValue
}

/**
 * Delete transaction item
 */
export interface Delete {
  TableName: string
  Key: Key
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValuesOnConditionCheckFailure?: ReturnValue
}

/**
 * Update transaction item
 */
export interface Update {
  TableName: string
  Key: Key
  UpdateExpression: string
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValuesOnConditionCheckFailure?: ReturnValue
}

/**
 * Condition check
 */
export interface ConditionCheck {
  TableName: string
  Key: Key
  ConditionExpression: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
  ReturnValuesOnConditionCheckFailure?: ReturnValue
}

/**
 * TransactWrite item
 */
export interface TransactWriteItem {
  Put?: Put
  Delete?: Delete
  Update?: Update
  ConditionCheck?: ConditionCheck
}

/**
 * TransactWriteItems command input
 */
export interface TransactWriteItemsCommandInput {
  TransactItems: TransactWriteItem[]
  ReturnConsumedCapacity?: ReturnConsumedCapacity
  ReturnItemCollectionMetrics?: ReturnItemCollectionMetrics
  ClientRequestToken?: string
}

/**
 * TransactWriteItems command output
 */
export interface TransactWriteItemsCommandOutput {
  ConsumedCapacity?: ConsumedCapacity[]
  ItemCollectionMetrics?: Record<string, ItemCollectionMetrics[]>
  $metadata: ResponseMetadata
}

// ============================================================================
// CLIENT CONFIGURATION
// ============================================================================

/**
 * Response metadata
 */
export interface ResponseMetadata {
  httpStatusCode?: number
  requestId?: string
  attempts?: number
  totalRetryDelay?: number
}

/**
 * Credentials
 */
export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/**
 * DynamoDB client configuration
 */
export interface DynamoDBClientConfig {
  region?: string
  credentials?: Credentials
  endpoint?: string
  maxAttempts?: number
  retryMode?: 'standard' | 'adaptive'
}

/**
 * Extended client configuration for DO backing
 */
export interface ExtendedDynamoDBClientConfig extends DynamoDBClientConfig {
  /** DO namespace binding */
  doNamespace?: DurableObjectNamespace
  /** Shard configuration */
  shard?: {
    algorithm?: 'consistent' | 'range' | 'hash'
    count?: number
    key?: string
  }
  /** Replica configuration */
  replica?: {
    readPreference?: 'primary' | 'secondary' | 'nearest'
    writeThrough?: boolean
    jurisdiction?: 'eu' | 'us' | 'fedramp'
  }
}

// ============================================================================
// COMMAND TYPES
// ============================================================================

/**
 * Base command interface
 */
export interface Command<Input, Output> {
  readonly input: Input
}

/**
 * Command class for CreateTable
 */
export class CreateTableCommand implements Command<CreateTableCommandInput, CreateTableCommandOutput> {
  readonly input: CreateTableCommandInput
  constructor(input: CreateTableCommandInput) {
    this.input = input
  }
}

/**
 * Command class for DeleteTable
 */
export class DeleteTableCommand implements Command<DeleteTableCommandInput, DeleteTableCommandOutput> {
  readonly input: DeleteTableCommandInput
  constructor(input: DeleteTableCommandInput) {
    this.input = input
  }
}

/**
 * Command class for DescribeTable
 */
export class DescribeTableCommand implements Command<DescribeTableCommandInput, DescribeTableCommandOutput> {
  readonly input: DescribeTableCommandInput
  constructor(input: DescribeTableCommandInput) {
    this.input = input
  }
}

/**
 * Command class for ListTables
 */
export class ListTablesCommand implements Command<ListTablesCommandInput, ListTablesCommandOutput> {
  readonly input: ListTablesCommandInput
  constructor(input: ListTablesCommandInput) {
    this.input = input
  }
}

/**
 * Command class for PutItem
 */
export class PutItemCommand implements Command<PutItemCommandInput, PutItemCommandOutput> {
  readonly input: PutItemCommandInput
  constructor(input: PutItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for GetItem
 */
export class GetItemCommand implements Command<GetItemCommandInput, GetItemCommandOutput> {
  readonly input: GetItemCommandInput
  constructor(input: GetItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for UpdateItem
 */
export class UpdateItemCommand implements Command<UpdateItemCommandInput, UpdateItemCommandOutput> {
  readonly input: UpdateItemCommandInput
  constructor(input: UpdateItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for DeleteItem
 */
export class DeleteItemCommand implements Command<DeleteItemCommandInput, DeleteItemCommandOutput> {
  readonly input: DeleteItemCommandInput
  constructor(input: DeleteItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for Query
 */
export class QueryCommand implements Command<QueryCommandInput, QueryCommandOutput> {
  readonly input: QueryCommandInput
  constructor(input: QueryCommandInput) {
    this.input = input
  }
}

/**
 * Command class for Scan
 */
export class ScanCommand implements Command<ScanCommandInput, ScanCommandOutput> {
  readonly input: ScanCommandInput
  constructor(input: ScanCommandInput) {
    this.input = input
  }
}

/**
 * Command class for BatchWriteItem
 */
export class BatchWriteItemCommand implements Command<BatchWriteItemCommandInput, BatchWriteItemCommandOutput> {
  readonly input: BatchWriteItemCommandInput
  constructor(input: BatchWriteItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for BatchGetItem
 */
export class BatchGetItemCommand implements Command<BatchGetItemCommandInput, BatchGetItemCommandOutput> {
  readonly input: BatchGetItemCommandInput
  constructor(input: BatchGetItemCommandInput) {
    this.input = input
  }
}

/**
 * Command class for TransactGetItems
 */
export class TransactGetItemsCommand implements Command<TransactGetItemsCommandInput, TransactGetItemsCommandOutput> {
  readonly input: TransactGetItemsCommandInput
  constructor(input: TransactGetItemsCommandInput) {
    this.input = input
  }
}

/**
 * Command class for TransactWriteItems
 */
export class TransactWriteItemsCommand implements Command<TransactWriteItemsCommandInput, TransactWriteItemsCommandOutput> {
  readonly input: TransactWriteItemsCommandInput
  constructor(input: TransactWriteItemsCommandInput) {
    this.input = input
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Base DynamoDB error
 */
export class DynamoDBServiceException extends Error {
  readonly $fault: 'client' | 'server'
  readonly $service: string = 'DynamoDB'
  readonly $metadata: ResponseMetadata

  constructor(
    message: string,
    options: { $fault: 'client' | 'server'; $metadata?: ResponseMetadata }
  ) {
    super(message)
    this.name = 'DynamoDBServiceException'
    this.$fault = options.$fault
    this.$metadata = options.$metadata ?? {}
  }
}

/**
 * Resource not found exception
 */
export class ResourceNotFoundException extends DynamoDBServiceException {
  constructor(message: string = 'Resource not found') {
    super(message, { $fault: 'client' })
    this.name = 'ResourceNotFoundException'
  }
}

/**
 * Resource in use exception
 */
export class ResourceInUseException extends DynamoDBServiceException {
  constructor(message: string = 'Resource in use') {
    super(message, { $fault: 'client' })
    this.name = 'ResourceInUseException'
  }
}

/**
 * Conditional check failed exception
 */
export class ConditionalCheckFailedException extends DynamoDBServiceException {
  Item?: Item

  constructor(message: string = 'Conditional check failed', item?: Item) {
    super(message, { $fault: 'client' })
    this.name = 'ConditionalCheckFailedException'
    this.Item = item
  }
}

/**
 * Transaction canceled exception
 */
export class TransactionCanceledException extends DynamoDBServiceException {
  CancellationReasons?: CancellationReason[]

  constructor(message: string = 'Transaction canceled', reasons?: CancellationReason[]) {
    super(message, { $fault: 'client' })
    this.name = 'TransactionCanceledException'
    this.CancellationReasons = reasons
  }
}

/**
 * Cancellation reason
 */
export interface CancellationReason {
  Code?: string
  Message?: string
  Item?: Item
}

/**
 * Validation exception
 */
export class ValidationException extends DynamoDBServiceException {
  constructor(message: string = 'Validation exception') {
    super(message, { $fault: 'client' })
    this.name = 'ValidationException'
  }
}

/**
 * Provisioned throughput exceeded exception
 */
export class ProvisionedThroughputExceededException extends DynamoDBServiceException {
  constructor(message: string = 'Provisioned throughput exceeded') {
    super(message, { $fault: 'client' })
    this.name = 'ProvisionedThroughputExceededException'
  }
}

/**
 * Item collection size limit exceeded exception
 */
export class ItemCollectionSizeLimitExceededException extends DynamoDBServiceException {
  constructor(message: string = 'Item collection size limit exceeded') {
    super(message, { $fault: 'client' })
    this.name = 'ItemCollectionSizeLimitExceededException'
  }
}

// ============================================================================
// MARSHALLING UTILITIES
// ============================================================================

/**
 * Marshal JavaScript value to DynamoDB AttributeValue
 */
export function marshall(data: unknown): AttributeValue {
  if (data === null || data === undefined) {
    return { NULL: true }
  }
  if (typeof data === 'string') {
    return { S: data }
  }
  if (typeof data === 'number') {
    return { N: String(data) }
  }
  if (typeof data === 'boolean') {
    return { BOOL: data }
  }
  if (data instanceof Uint8Array) {
    return { B: data }
  }
  if (Array.isArray(data)) {
    // Check if it's a set
    if (data.length > 0) {
      const first = data[0]
      if (typeof first === 'string' && data.every((v) => typeof v === 'string')) {
        // Could be SS, but lists are more common - treat as L
        return { L: data.map((v) => marshall(v)) }
      }
      if (typeof first === 'number' && data.every((v) => typeof v === 'number')) {
        // Could be NS, but lists are more common - treat as L
        return { L: data.map((v) => marshall(v)) }
      }
    }
    return { L: data.map((v) => marshall(v)) }
  }
  if (typeof data === 'object') {
    const result: Record<string, AttributeValue> = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = marshall(value)
    }
    return { M: result }
  }
  throw new Error(`Cannot marshall value of type ${typeof data}`)
}

/**
 * Marshal a record (object) to DynamoDB item format
 */
export function marshallItem(data: Record<string, unknown>): Item {
  const result: Item = {}
  for (const [key, value] of Object.entries(data)) {
    result[key] = marshall(value)
  }
  return result
}

/**
 * Unmarshall DynamoDB AttributeValue to JavaScript value
 */
export function unmarshall(data: AttributeValue): unknown {
  if (data.S !== undefined) return data.S
  if (data.N !== undefined) return Number(data.N)
  if (data.B !== undefined) return data.B
  if (data.SS !== undefined) return new Set(data.SS)
  if (data.NS !== undefined) return new Set(data.NS.map(Number))
  if (data.BS !== undefined) return new Set(data.BS)
  if (data.NULL !== undefined) return null
  if (data.BOOL !== undefined) return data.BOOL
  if (data.L !== undefined) return data.L.map((v) => unmarshall(v))
  if (data.M !== undefined) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data.M)) {
      result[key] = unmarshall(value)
    }
    return result
  }
  throw new Error('Unknown attribute value type')
}

/**
 * Unmarshall DynamoDB item to JavaScript record
 */
export function unmarshallItem(data: Item): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    result[key] = unmarshall(value)
  }
  return result
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * DynamoDB Client interface
 */
export interface DynamoDBClient {
  send<Input, Output>(command: Command<Input, Output>): Promise<Output>
  destroy(): void
  config: DynamoDBClientConfig
}
