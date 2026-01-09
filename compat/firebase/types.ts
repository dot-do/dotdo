/**
 * @dotdo/firebase types
 *
 * Firebase Firestore and Realtime Database compatible type definitions
 * for DO SQLite-backed implementation.
 *
 * @see https://firebase.google.com/docs/firestore/reference/js
 * @see https://firebase.google.com/docs/database/web/read-and-write
 */

// ============================================================================
// FIREBASE APP TYPES
// ============================================================================

/**
 * Firebase app configuration
 */
export interface FirebaseConfig {
  apiKey?: string
  authDomain?: string
  projectId: string
  storageBucket?: string
  messagingSenderId?: string
  appId?: string
  measurementId?: string
  databaseURL?: string
}

/**
 * Firebase app instance
 */
export interface FirebaseApp {
  /** App name (default: '[DEFAULT]') */
  readonly name: string
  /** App configuration */
  readonly options: FirebaseConfig
  /** Whether the app has been deleted */
  automaticDataCollectionEnabled: boolean
}

/**
 * Extended config for DO-backed implementation
 */
export interface ExtendedFirebaseConfig extends FirebaseConfig {
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
// FIRESTORE TYPES
// ============================================================================

/**
 * Firestore instance
 */
export interface Firestore {
  /** The app associated with this Firestore instance */
  readonly app: FirebaseApp
  /** Type identifier */
  readonly type: 'firestore'
  /** JSON conversion */
  toJSON(): Record<string, unknown>
}

/**
 * A Firestore document reference
 */
export interface DocumentReference<T = DocumentData> {
  /** Document ID */
  readonly id: string
  /** Document path */
  readonly path: string
  /** Parent collection */
  readonly parent: CollectionReference<T>
  /** Firestore instance */
  readonly firestore: Firestore
  /** Type identifier */
  readonly type: 'document'
  /** Convert to string */
  toString(): string
  /** Check equality with another reference */
  isEqual(other: DocumentReference<T>): boolean
  /** Get a reference to a subcollection */
  collection(collectionPath: string): CollectionReference<DocumentData>
  /** Create a copy with a converter */
  withConverter<U>(converter: FirestoreDataConverter<U>): DocumentReference<U>
  withConverter(converter: null): DocumentReference<DocumentData>
}

/**
 * A Firestore collection reference
 */
export interface CollectionReference<T = DocumentData> extends Query<T> {
  /** Collection ID */
  readonly id: string
  /** Collection path */
  readonly path: string
  /** Parent document (null for root collections) */
  readonly parent: DocumentReference<DocumentData> | null
  /** Type identifier */
  readonly type: 'collection'
  /** Get a document reference */
  doc(documentPath?: string): DocumentReference<T>
  /** Create a copy with a converter */
  withConverter<U>(converter: FirestoreDataConverter<U>): CollectionReference<U>
  withConverter(converter: null): CollectionReference<DocumentData>
}

/**
 * Document data (record of field values)
 */
export type DocumentData = Record<string, unknown>

/**
 * Partial document data with field paths
 */
export type PartialWithFieldValue<T> = Partial<T> | { [key: string]: unknown }

/**
 * Update data with field values
 */
export type UpdateData<T> = Partial<T> | { [key: string]: unknown }

/**
 * Set options
 */
export interface SetOptions {
  /** Merge with existing document */
  merge?: boolean
  /** Merge only specified fields */
  mergeFields?: Array<string | FieldPath>
}

/**
 * Data converter for type-safe documents
 */
export interface FirestoreDataConverter<T> {
  /** Convert app data to Firestore format */
  toFirestore(modelObject: T): DocumentData
  toFirestore(modelObject: Partial<T>, options: SetOptions): DocumentData
  /** Convert Firestore data to app format */
  fromFirestore(snapshot: QueryDocumentSnapshot<DocumentData>): T
}

// ============================================================================
// DOCUMENT SNAPSHOT TYPES
// ============================================================================

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  /** From cache or server */
  readonly fromCache: boolean
  /** Has pending writes */
  readonly hasPendingWrites: boolean
  /** Check equality */
  isEqual(other: SnapshotMetadata): boolean
}

/**
 * Document snapshot options
 */
export interface SnapshotOptions {
  /** How to handle server timestamps */
  readonly serverTimestamps?: 'estimate' | 'previous' | 'none'
}

/**
 * A document snapshot (may or may not exist)
 */
export interface DocumentSnapshot<T = DocumentData> {
  /** Whether the document exists */
  readonly exists: boolean
  /** Document ID */
  readonly id: string
  /** Document reference */
  readonly ref: DocumentReference<T>
  /** Snapshot metadata */
  readonly metadata: SnapshotMetadata
  /** Get document data */
  data(options?: SnapshotOptions): T | undefined
  /** Get a specific field */
  get(fieldPath: string | FieldPath, options?: SnapshotOptions): unknown
}

/**
 * A document snapshot that is guaranteed to exist
 */
export interface QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  readonly exists: true
  data(options?: SnapshotOptions): T
}

/**
 * Snapshot listen options
 */
export interface SnapshotListenOptions {
  /** Include metadata changes */
  readonly includeMetadataChanges?: boolean
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query constraint types
 */
export type QueryConstraintType =
  | 'where'
  | 'orderBy'
  | 'limit'
  | 'limitToLast'
  | 'startAt'
  | 'startAfter'
  | 'endAt'
  | 'endBefore'

/**
 * Where filter operators
 */
export type WhereFilterOp =
  | '<'
  | '<='
  | '=='
  | '!='
  | '>='
  | '>'
  | 'array-contains'
  | 'array-contains-any'
  | 'in'
  | 'not-in'

/**
 * Order direction
 */
export type OrderByDirection = 'asc' | 'desc'

/**
 * Query constraint
 */
export interface QueryConstraint {
  /** Constraint type */
  readonly type: QueryConstraintType
}

/**
 * Where constraint
 */
export interface QueryWhereConstraint extends QueryConstraint {
  readonly type: 'where'
  readonly _field: string | FieldPath
  readonly _op: WhereFilterOp
  readonly _value: unknown
}

/**
 * OrderBy constraint
 */
export interface QueryOrderByConstraint extends QueryConstraint {
  readonly type: 'orderBy'
  readonly _field: string | FieldPath
  readonly _direction: OrderByDirection
}

/**
 * Limit constraint
 */
export interface QueryLimitConstraint extends QueryConstraint {
  readonly type: 'limit' | 'limitToLast'
  readonly _limit: number
}

/**
 * Cursor constraint (startAt, startAfter, endAt, endBefore)
 */
export interface QueryCursorConstraint extends QueryConstraint {
  readonly type: 'startAt' | 'startAfter' | 'endAt' | 'endBefore'
  readonly _values: unknown[]
}

/**
 * A Firestore query
 */
export interface Query<T = DocumentData> {
  /** Firestore instance */
  readonly firestore: Firestore
  /** Type identifier */
  readonly type: 'query' | 'collection'
  /** Create a copy with a converter */
  withConverter<U>(converter: FirestoreDataConverter<U>): Query<U>
  withConverter(converter: null): Query<DocumentData>
}

/**
 * Query snapshot
 */
export interface QuerySnapshot<T = DocumentData> {
  /** Query that produced this snapshot */
  readonly query: Query<T>
  /** All documents */
  readonly docs: QueryDocumentSnapshot<T>[]
  /** Number of documents */
  readonly size: number
  /** Whether the snapshot is empty */
  readonly empty: boolean
  /** Snapshot metadata */
  readonly metadata: SnapshotMetadata
  /** Iterate over documents */
  forEach(callback: (result: QueryDocumentSnapshot<T>) => void, thisArg?: unknown): void
  /** Get document changes since last snapshot */
  docChanges(options?: SnapshotListenOptions): DocumentChange<T>[]
}

/**
 * Document change types
 */
export type DocumentChangeType = 'added' | 'modified' | 'removed'

/**
 * A document change
 */
export interface DocumentChange<T = DocumentData> {
  /** Type of change */
  readonly type: DocumentChangeType
  /** Changed document */
  readonly doc: QueryDocumentSnapshot<T>
  /** Old index (-1 for added) */
  readonly oldIndex: number
  /** New index (-1 for removed) */
  readonly newIndex: number
}

// ============================================================================
// FIELD TYPES
// ============================================================================

/**
 * Field path reference
 */
export interface FieldPath {
  /** Check equality */
  isEqual(other: FieldPath): boolean
}

/**
 * Document ID field path
 */
export interface DocumentIdFieldPath extends FieldPath {
  /** Marker for document ID */
  readonly __type__: 'documentId'
}

/**
 * Field value sentinel
 */
export interface FieldValue {
  /** Check equality */
  isEqual(other: FieldValue): boolean
}

/**
 * Delete field sentinel
 */
export interface DeleteFieldValue extends FieldValue {
  /** Marker for delete */
  readonly __type__: 'delete'
}

/**
 * Server timestamp sentinel
 */
export interface ServerTimestampFieldValue extends FieldValue {
  /** Marker for server timestamp */
  readonly __type__: 'serverTimestamp'
}

/**
 * Array union sentinel
 */
export interface ArrayUnionFieldValue extends FieldValue {
  /** Marker for array union */
  readonly __type__: 'arrayUnion'
  readonly _elements: unknown[]
}

/**
 * Array remove sentinel
 */
export interface ArrayRemoveFieldValue extends FieldValue {
  /** Marker for array remove */
  readonly __type__: 'arrayRemove'
  readonly _elements: unknown[]
}

/**
 * Increment sentinel
 */
export interface IncrementFieldValue extends FieldValue {
  /** Marker for increment */
  readonly __type__: 'increment'
  readonly _operand: number
}

// ============================================================================
// GEO TYPES
// ============================================================================

/**
 * Geo point (latitude/longitude)
 */
export interface GeoPoint {
  /** Latitude (-90 to 90) */
  readonly latitude: number
  /** Longitude (-180 to 180) */
  readonly longitude: number
  /** Check equality */
  isEqual(other: GeoPoint): boolean
  /** Convert to JSON */
  toJSON(): { latitude: number; longitude: number }
}

// ============================================================================
// TIMESTAMP TYPE
// ============================================================================

/**
 * Firestore timestamp
 */
export interface Timestamp {
  /** Seconds since epoch */
  readonly seconds: number
  /** Nanoseconds (0-999999999) */
  readonly nanoseconds: number
  /** Convert to Date */
  toDate(): Date
  /** Convert to milliseconds */
  toMillis(): number
  /** Check equality */
  isEqual(other: Timestamp): boolean
  /** Convert to JSON */
  toJSON(): { seconds: number; nanoseconds: number }
  /** String representation */
  toString(): string
  /** Value for comparison */
  valueOf(): string
}

// ============================================================================
// BYTES TYPE
// ============================================================================

/**
 * Binary data wrapper
 */
export interface Bytes {
  /** Convert to base64 */
  toBase64(): string
  /** Convert to Uint8Array */
  toUint8Array(): Uint8Array
  /** Check equality */
  isEqual(other: Bytes): boolean
}

// ============================================================================
// WRITE BATCH & TRANSACTION TYPES
// ============================================================================

/**
 * Write batch for atomic operations
 */
export interface WriteBatch {
  /** Set a document */
  set<T>(documentRef: DocumentReference<T>, data: T, options?: SetOptions): WriteBatch
  /** Update a document */
  update<T>(documentRef: DocumentReference<T>, data: UpdateData<T>): WriteBatch
  update<T>(documentRef: DocumentReference<T>, field: string | FieldPath, value: unknown, ...moreFieldsAndValues: unknown[]): WriteBatch
  /** Delete a document */
  delete(documentRef: DocumentReference<unknown>): WriteBatch
  /** Commit the batch */
  commit(): Promise<void>
}

/**
 * Transaction for read-write operations
 */
export interface Transaction {
  /** Get a document */
  get<T>(documentRef: DocumentReference<T>): Promise<DocumentSnapshot<T>>
  /** Set a document */
  set<T>(documentRef: DocumentReference<T>, data: T, options?: SetOptions): Transaction
  /** Update a document */
  update<T>(documentRef: DocumentReference<T>, data: UpdateData<T>): Transaction
  update<T>(documentRef: DocumentReference<T>, field: string | FieldPath, value: unknown, ...moreFieldsAndValues: unknown[]): Transaction
  /** Delete a document */
  delete(documentRef: DocumentReference<unknown>): Transaction
}

/**
 * Transaction update function
 */
export type TransactionUpdateFunction<T> = (transaction: Transaction) => Promise<T>

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Max retry attempts */
  readonly maxAttempts?: number
}

// ============================================================================
// AGGREGATION TYPES
// ============================================================================

/**
 * Aggregate query snapshot
 */
export interface AggregateQuerySnapshot<T extends AggregateSpec> {
  /** Query that produced this snapshot */
  readonly query: AggregateQuery<T>
  /** Get aggregate data */
  data(): AggregateSpecData<T>
}

/**
 * Aggregate spec (count, sum, average)
 */
export interface AggregateSpec {
  [key: string]: AggregateField<unknown>
}

/**
 * Aggregate spec data
 */
export type AggregateSpecData<T extends AggregateSpec> = {
  [K in keyof T]: T[K] extends AggregateField<infer U> ? U : never
}

/**
 * Aggregate field
 */
export interface AggregateField<T> {
  /** Aggregate type */
  readonly aggregateType: 'count' | 'sum' | 'avg'
  /** Type marker */
  readonly _type: T
}

/**
 * Aggregate query
 */
export interface AggregateQuery<T extends AggregateSpec> {
  /** Query being aggregated */
  readonly query: Query<unknown>
  /** Aggregate type */
  readonly type: 'AggregateQuery'
}

// ============================================================================
// LISTENER TYPES
// ============================================================================

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void

/**
 * Snapshot observer
 */
export interface SnapshotObserver<T> {
  next?: (snapshot: T) => void
  error?: (error: FirestoreError) => void
  complete?: () => void
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Firestore error codes
 */
export type FirestoreErrorCode =
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss'
  | 'unauthenticated'

/**
 * Firestore error
 */
export class FirestoreError extends Error {
  readonly code: FirestoreErrorCode
  readonly name: string = 'FirestoreError'

  constructor(code: FirestoreErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// ============================================================================
// REALTIME DATABASE TYPES
// ============================================================================

/**
 * Realtime Database instance
 */
export interface Database {
  /** The app associated with this Database instance */
  readonly app: FirebaseApp
  /** Type identifier */
  readonly type: 'database'
  /** Database URL */
  readonly url: string
}

/**
 * Database reference
 */
export interface DatabaseReference {
  /** Reference key (last segment) */
  readonly key: string | null
  /** Parent reference */
  readonly parent: DatabaseReference | null
  /** Root reference */
  readonly root: DatabaseReference
  /** Full path */
  readonly path: string
  /** Database instance */
  readonly database: Database
  /** Get child reference */
  child(path: string): DatabaseReference
  /** Push new child */
  push(): ThenableReference
  /** Convert to string */
  toString(): string
  /** Check equality */
  isEqual(other: DatabaseReference | null): boolean
}

/**
 * Thenable reference (push result)
 */
export interface ThenableReference extends DatabaseReference, Promise<DatabaseReference> {
  /** The auto-generated key */
  readonly key: string
}

/**
 * Database snapshot
 */
export interface DataSnapshot {
  /** Snapshot key */
  readonly key: string | null
  /** Reference that produced this snapshot */
  readonly ref: DatabaseReference
  /** Number of children */
  readonly size: number
  /** Whether this snapshot has any children */
  hasChildren(): boolean
  /** Whether this snapshot exists */
  exists(): boolean
  /** Get the snapshot value */
  val(): unknown
  /** Export value with priority */
  exportVal(): unknown
  /** Iterate over children */
  forEach(callback: (child: DataSnapshot) => boolean | void): boolean
  /** Check if child exists */
  hasChild(path: string): boolean
  /** Get child snapshot */
  child(path: string): DataSnapshot
  /** Get priority */
  getPriority(): string | number | null
  /** Convert to JSON */
  toJSON(): Record<string, unknown> | null
}

/**
 * Database event types
 */
export type EventType = 'value' | 'child_added' | 'child_changed' | 'child_removed' | 'child_moved'

/**
 * Database query
 */
export interface DatabaseQuery {
  /** Reference being queried */
  readonly ref: DatabaseReference
  /** Check equality */
  isEqual(other: DatabaseQuery | null): boolean
  /** Convert to JSON */
  toJSON(): string
  /** Get full URL */
  toString(): string
}

/**
 * Query constraint (RTDB style)
 */
export interface DatabaseQueryConstraint {
  /** Constraint type */
  readonly type: string
}

/**
 * Database listener callback
 */
export type DatabaseListenerCallback = (snapshot: DataSnapshot, previousChildKey?: string | null) => unknown

/**
 * Database error callback
 */
export type DatabaseErrorCallback = (error: Error) => unknown

/**
 * Transaction result
 */
export interface TransactionResult {
  /** Whether committed */
  readonly committed: boolean
  /** Final snapshot */
  readonly snapshot: DataSnapshot
}

/**
 * Transaction options (RTDB)
 */
export interface DatabaseTransactionOptions {
  /** Apply locally first */
  readonly applyLocally?: boolean
}

// ============================================================================
// PERSISTENCE TYPES
// ============================================================================

/**
 * Persistence settings
 */
export interface PersistenceSettings {
  /** Force long polling instead of WebSocket */
  readonly forceOwnership?: boolean
}

/**
 * Index configuration
 */
export interface IndexConfiguration {
  /** Collection indexes */
  readonly indexes?: Array<{
    collectionGroup: string
    queryScope?: 'COLLECTION' | 'COLLECTION_GROUP'
    fields?: Array<{
      fieldPath: string
      order?: 'ASCENDING' | 'DESCENDING'
      arrayConfig?: 'CONTAINS'
    }>
  }>
  /** Field overrides */
  readonly fieldOverrides?: Array<{
    collectionGroup: string
    fieldPath: string
    indexes?: Array<{
      queryScope?: 'COLLECTION' | 'COLLECTION_GROUP'
      order?: 'ASCENDING' | 'DESCENDING'
      arrayConfig?: 'CONTAINS'
    }>
  }>
}

// ============================================================================
// LOAD BUNDLE TYPES
// ============================================================================

/**
 * Bundle load result
 */
export interface LoadBundleTask {
  /** Promise that resolves when complete */
  then(onFulfilled?: (value: LoadBundleTaskProgress) => unknown, onRejected?: (error: Error) => unknown): Promise<unknown>
  /** Catch errors */
  catch(onRejected: (error: Error) => unknown): Promise<unknown>
  /** Progress handler */
  onProgress(next: (progress: LoadBundleTaskProgress) => unknown): void
}

/**
 * Bundle load progress
 */
export interface LoadBundleTaskProgress {
  /** Documents loaded */
  readonly documentsLoaded: number
  /** Total documents */
  readonly totalDocuments: number
  /** Bytes loaded */
  readonly bytesLoaded: number
  /** Total bytes */
  readonly totalBytes: number
  /** Task state */
  readonly taskState: 'Running' | 'Success' | 'Error'
}

/**
 * Named query from bundle
 */
export interface NamedQuery {
  /** Query name */
  readonly name: string
  /** The query */
  readonly query: Query<DocumentData>
  /** When the query was read */
  readonly readTime: Timestamp
}
