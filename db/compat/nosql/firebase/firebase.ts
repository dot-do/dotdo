/**
 * @dotdo/firebase - Firebase SDK compat
 *
 * Drop-in replacement for Firebase Firestore and Realtime Database
 * backed by DO SQLite storage. This in-memory implementation matches
 * the Firebase JS SDK API for testing purposes.
 *
 * @see https://firebase.google.com/docs/firestore/reference/js
 * @see https://firebase.google.com/docs/database/web/read-and-write
 */
import type {
  FirebaseApp,
  FirebaseConfig,
  ExtendedFirebaseConfig,
  Firestore,
  Database,
  DocumentReference,
  CollectionReference,
  DocumentSnapshot,
  QuerySnapshot,
  QueryDocumentSnapshot,
  Query,
  QueryConstraint,
  QueryWhereConstraint,
  QueryOrderByConstraint,
  QueryLimitConstraint,
  QueryCursorConstraint,
  DocumentData,
  SetOptions,
  UpdateData,
  WriteBatch,
  Transaction,
  TransactionOptions,
  SnapshotMetadata,
  SnapshotOptions,
  SnapshotListenOptions,
  DocumentChange,
  WhereFilterOp,
  OrderByDirection,
  FieldPath as IFieldPath,
  FieldValue,
  GeoPoint as GeoPointType,
  Timestamp as TimestampType,
  Bytes as BytesType,
  AggregateSpec,
  AggregateField,
  AggregateQuerySnapshot,
  Unsubscribe,
  Database as DatabaseType,
  DatabaseReference,
  DataSnapshot,
  ThenableReference,
  DatabaseQueryConstraint,
  TransactionResult,
  FirestoreDataConverter,
} from './types'
import { FirestoreError } from './types'

// ============================================================================
// APP MANAGEMENT
// ============================================================================

const apps = new Map<string, FirebaseApp>()
const firestoreInstances = new Map<string, FirestoreImpl>()
const databaseInstances = new Map<string, DatabaseImpl>()

/**
 * Initialize a Firebase app
 */
export function initializeApp(config: FirebaseConfig | ExtendedFirebaseConfig, name = '[DEFAULT]'): FirebaseApp {
  if (apps.has(name)) {
    throw new Error(`Firebase app named '${name}' already exists`)
  }

  const app: FirebaseApp = {
    name,
    options: config,
    automaticDataCollectionEnabled: false,
  }

  apps.set(name, app)
  return app
}

/**
 * Get a Firebase app by name
 */
export function getApp(name = '[DEFAULT]'): FirebaseApp {
  const app = apps.get(name)
  if (!app) {
    throw new Error(`No Firebase app '${name}' has been created - call initializeApp() first`)
  }
  return app
}

/**
 * Get all initialized apps
 */
export function getApps(): FirebaseApp[] {
  return Array.from(apps.values())
}

/**
 * Delete a Firebase app
 */
export async function deleteApp(app: FirebaseApp): Promise<void> {
  apps.delete(app.name)
  firestoreInstances.delete(app.name)
  databaseInstances.delete(app.name)
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface StoredDocument {
  data: DocumentData
  createTime: number
  updateTime: number
}

class InMemoryFirestore {
  private collections = new Map<string, Map<string, StoredDocument>>()
  private listeners = new Map<string, Set<() => void>>()

  getDocument(path: string): StoredDocument | undefined {
    const [collectionPath, docId] = this.splitPath(path)
    const collection = this.collections.get(collectionPath)
    return collection?.get(docId)
  }

  setDocument(path: string, data: DocumentData, options?: SetOptions, fieldsToDelete?: string[]): void {
    const [collectionPath, docId] = this.splitPath(path)

    if (!this.collections.has(collectionPath)) {
      this.collections.set(collectionPath, new Map())
    }

    const collection = this.collections.get(collectionPath)!
    const existing = collection.get(docId)
    const now = Date.now()

    if (options?.merge && existing) {
      // Merge data
      const merged = { ...existing.data, ...data }
      // Remove fields marked for deletion
      if (fieldsToDelete) {
        for (const field of fieldsToDelete) {
          delete merged[field]
        }
      }
      collection.set(docId, {
        data: merged,
        createTime: existing.createTime,
        updateTime: now,
      })
    } else if (options?.mergeFields && existing) {
      // Merge only specified fields
      const merged = { ...existing.data }
      for (const field of options.mergeFields) {
        const fieldName = typeof field === 'string' ? field : (field as any)._segments?.join('.') ?? ''
        if (fieldName in data) {
          merged[fieldName] = data[fieldName]
        }
      }
      // Remove fields marked for deletion
      if (fieldsToDelete) {
        for (const field of fieldsToDelete) {
          delete merged[field]
        }
      }
      collection.set(docId, {
        data: merged,
        createTime: existing.createTime,
        updateTime: now,
      })
    } else {
      // Overwrite
      collection.set(docId, {
        data,
        createTime: existing?.createTime ?? now,
        updateTime: now,
      })
    }

    this.notifyListeners(collectionPath)
    this.notifyListeners(path)
  }

  updateDocument(path: string, data: UpdateData<DocumentData>): void {
    const existing = this.getDocument(path)
    if (!existing) {
      throw new FirestoreError('not-found', `Document ${path} not found`)
    }

    const [collectionPath, docId] = this.splitPath(path)
    const collection = this.collections.get(collectionPath)!

    // Handle nested field updates (dot notation) and field values
    const updated = { ...existing.data }
    for (const [key, value] of Object.entries(data)) {
      // Check if this is a FieldValue
      if (value && typeof value === 'object' && '__type__' in value) {
        const fv = value as any
        switch (fv.__type__) {
          case 'serverTimestamp': {
            const targetKey = key.includes('.') ? key.split('.').pop()! : key
            this.setNestedValue(updated, key, Timestamp.now())
            break
          }
          case 'delete': {
            // Delete the field
            if (key.includes('.')) {
              const parts = key.split('.')
              let obj = updated as any
              for (let i = 0; i < parts.length - 1; i++) {
                if (!(parts[i]! in obj)) break
                obj = obj[parts[i]!]
              }
              delete obj[parts[parts.length - 1]!]
            } else {
              delete updated[key]
            }
            break
          }
          case 'increment': {
            const existingValue = this.getNestedValue(updated, key)
            const newValue = (typeof existingValue === 'number' ? existingValue : 0) + fv._operand
            this.setNestedValue(updated, key, newValue)
            break
          }
          case 'arrayUnion': {
            const existingArray = this.getNestedValue(updated, key)
            const arr = Array.isArray(existingArray) ? [...existingArray] : []
            for (const elem of fv._elements) {
              if (!arr.includes(elem)) {
                arr.push(elem)
              }
            }
            this.setNestedValue(updated, key, arr)
            break
          }
          case 'arrayRemove': {
            const existingArray = this.getNestedValue(updated, key)
            const arr = Array.isArray(existingArray) ? [...existingArray] : []
            const filtered = arr.filter((item: unknown) => !fv._elements.includes(item))
            this.setNestedValue(updated, key, filtered)
            break
          }
          default:
            this.setNestedValue(updated, key, value)
        }
      } else if (key.includes('.')) {
        // Handle nested path
        this.setNestedValue(updated, key, value)
      } else {
        updated[key] = value
      }
    }

    collection.set(docId, {
      data: updated,
      createTime: existing.createTime,
      updateTime: Date.now(),
    })

    this.notifyListeners(collectionPath)
    this.notifyListeners(path)
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!
      if (!(key in current)) current[key] = {}
      current = current[key] as Record<string, unknown>
    }
    current[parts[parts.length - 1]!] = value
  }

  deleteDocument(path: string): void {
    const [collectionPath, docId] = this.splitPath(path)
    const collection = this.collections.get(collectionPath)
    if (collection) {
      collection.delete(docId)
      this.notifyListeners(collectionPath)
      this.notifyListeners(path)
    }
  }

  getCollection(path: string): Map<string, StoredDocument> {
    return this.collections.get(path) ?? new Map()
  }

  queryCollection(
    path: string,
    constraints: QueryConstraint[]
  ): Array<{ id: string; data: DocumentData }> {
    const collection = this.getCollection(path)
    let results = Array.from(collection.entries()).map(([id, doc]) => ({
      id,
      data: doc.data,
    }))

    // Find orderBy constraint to know which field to use for cursors
    const orderByConstraint = constraints.find((c) => c.type === 'orderBy') as QueryOrderByConstraint | undefined
    const orderField = orderByConstraint
      ? (typeof orderByConstraint._field === 'string' ? orderByConstraint._field : '')
      : null

    // Apply constraints in order
    for (const constraint of constraints) {
      results = this.applyConstraint(results, constraint, orderField)
    }

    return results
  }

  private applyConstraint(
    results: Array<{ id: string; data: DocumentData }>,
    constraint: QueryConstraint,
    orderField: string | null
  ): Array<{ id: string; data: DocumentData }> {
    switch (constraint.type) {
      case 'where': {
        const wc = constraint as QueryWhereConstraint
        const fieldPath = typeof wc._field === 'string' ? wc._field : ''
        return results.filter((doc) => this.evaluateWhere(doc.data, fieldPath, wc._op, wc._value))
      }
      case 'orderBy': {
        const oc = constraint as QueryOrderByConstraint
        const fieldPath = typeof oc._field === 'string' ? oc._field : ''
        const dir = oc._direction === 'desc' ? -1 : 1
        return [...results].sort((a, b) => {
          const aVal = this.getNestedValue(a.data, fieldPath) as string | number | null
          const bVal = this.getNestedValue(b.data, fieldPath) as string | number | null
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1
          if (bVal == null) return -1
          if (aVal < bVal) return -1 * dir
          if (aVal > bVal) return 1 * dir
          return 0
        })
      }
      case 'limit': {
        const lc = constraint as QueryLimitConstraint
        return results.slice(0, lc._limit)
      }
      case 'limitToLast': {
        const lc = constraint as QueryLimitConstraint
        return results.slice(-lc._limit)
      }
      case 'startAt': {
        const cc = constraint as QueryCursorConstraint
        const cursorValue = cc._values[0]
        // If cursor is a document snapshot, get its value for the order field
        const compareValue = this.getCursorValue(cursorValue, orderField) as string | number | null
        if (orderField) {
          const idx = results.findIndex((doc) => {
            const docValue = this.getNestedValue(doc.data, orderField) as string | number | null
            if (docValue == null || compareValue == null) return false
            return docValue >= compareValue
          })
          return idx >= 0 ? results.slice(idx) : results
        }
        return results
      }
      case 'startAfter': {
        const cc = constraint as QueryCursorConstraint
        const cursorValue = cc._values[0]
        const compareValue = this.getCursorValue(cursorValue, orderField) as string | number | null
        if (orderField) {
          const idx = results.findIndex((doc) => {
            const docValue = this.getNestedValue(doc.data, orderField) as string | number | null
            if (docValue == null || compareValue == null) return false
            return docValue > compareValue
          })
          return idx >= 0 ? results.slice(idx) : []
        }
        return results
      }
      case 'endAt': {
        const cc = constraint as QueryCursorConstraint
        const cursorValue = cc._values[0]
        const compareValue = this.getCursorValue(cursorValue, orderField) as string | number | null
        if (orderField) {
          const idx = results.findIndex((doc) => {
            const docValue = this.getNestedValue(doc.data, orderField) as string | number | null
            if (docValue == null || compareValue == null) return false
            return docValue > compareValue
          })
          return idx >= 0 ? results.slice(0, idx) : results
        }
        return results
      }
      case 'endBefore': {
        const cc = constraint as QueryCursorConstraint
        const cursorValue = cc._values[0]
        const compareValue = this.getCursorValue(cursorValue, orderField) as string | number | null
        if (orderField) {
          const idx = results.findIndex((doc) => {
            const docValue = this.getNestedValue(doc.data, orderField) as string | number | null
            if (docValue == null || compareValue == null) return false
            return docValue >= compareValue
          })
          return idx >= 0 ? results.slice(0, idx) : results
        }
        return results
      }
      default:
        return results
    }
  }

  private getCursorValue(cursor: unknown, orderField: string | null): unknown {
    // If cursor is a document snapshot, extract the order field value
    if (cursor && typeof cursor === 'object' && 'data' in cursor && typeof (cursor as any).data === 'function') {
      const data = (cursor as any).data()
      if (orderField && data) {
        return this.getNestedValue(data, orderField)
      }
    }
    // Otherwise return the raw value
    return cursor
  }

  private evaluateWhere(data: DocumentData, field: string, op: WhereFilterOp, value: unknown): boolean {
    const fieldValue = this.getNestedValue(data, field) as unknown

    switch (op) {
      case '==':
        return fieldValue === value
      case '!=':
        return fieldValue !== value
      case '<':
        return (fieldValue as number) < (value as number)
      case '<=':
        return (fieldValue as number) <= (value as number)
      case '>':
        return (fieldValue as number) > (value as number)
      case '>=':
        return (fieldValue as number) >= (value as number)
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue)
      case 'not-in':
        return Array.isArray(value) && !value.includes(fieldValue)
      case 'array-contains':
        return Array.isArray(fieldValue) && (fieldValue as unknown[]).includes(value)
      case 'array-contains-any':
        return (
          Array.isArray(fieldValue) &&
          Array.isArray(value) &&
          value.some((v) => (fieldValue as unknown[]).includes(v))
        )
      default:
        return true
    }
  }

  private getNestedValue(obj: DocumentData, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current == null) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  addListener(path: string, callback: () => void): () => void {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set())
    }
    this.listeners.get(path)!.add(callback)
    return () => {
      this.listeners.get(path)?.delete(callback)
    }
  }

  private notifyListeners(path: string): void {
    this.listeners.get(path)?.forEach((cb) => cb())
  }

  private splitPath(path: string): [string, string] {
    const parts = path.split('/')
    const docId = parts.pop()!
    return [parts.join('/'), docId]
  }
}

// ============================================================================
// FIRESTORE IMPLEMENTATION
// ============================================================================

class FirestoreImpl implements Firestore {
  readonly app: FirebaseApp
  readonly type = 'firestore' as const
  readonly _storage = new InMemoryFirestore()
  private _terminated = false

  constructor(app: FirebaseApp) {
    this.app = app
  }

  toJSON(): Record<string, unknown> {
    return {
      app: this.app.name,
      projectId: this.app.options.projectId,
    }
  }

  get terminated(): boolean {
    return this._terminated
  }

  terminate(): void {
    this._terminated = true
  }
}

/**
 * Get Firestore instance for an app
 */
export function getFirestore(app?: FirebaseApp): Firestore {
  const resolvedApp = app ?? getApp()

  if (!firestoreInstances.has(resolvedApp.name)) {
    firestoreInstances.set(resolvedApp.name, new FirestoreImpl(resolvedApp))
  }

  return firestoreInstances.get(resolvedApp.name)!
}

// ============================================================================
// COLLECTION & DOCUMENT REFERENCES
// ============================================================================

let autoIdCounter = 0

function generateAutoId(): string {
  return `auto_${Date.now()}_${++autoIdCounter}_${Math.random().toString(36).slice(2, 11)}`
}

class DocumentReferenceImpl<T = DocumentData> implements DocumentReference<T> {
  readonly id: string
  readonly path: string
  readonly firestore: Firestore
  readonly type = 'document' as const
  readonly parent: CollectionReference<T>
  private _converter: FirestoreDataConverter<T> | null = null

  constructor(firestore: Firestore, path: string, parent: CollectionReference<T>) {
    this.firestore = firestore
    this.path = path
    this.id = path.split('/').pop()!
    this.parent = parent
  }

  toString(): string {
    return this.path
  }

  isEqual(other: DocumentReference<T>): boolean {
    return this.path === other.path && this.firestore === other.firestore
  }

  collection(collectionPath: string): CollectionReference<DocumentData> {
    return new CollectionReferenceImpl(
      this.firestore,
      `${this.path}/${collectionPath}`,
      this as unknown as DocumentReference<DocumentData>
    )
  }

  withConverter<U>(converter: FirestoreDataConverter<U>): DocumentReference<U>
  withConverter(converter: null): DocumentReference<DocumentData>
  withConverter<U>(converter: FirestoreDataConverter<U> | null): DocumentReference<U> | DocumentReference<DocumentData> {
    const ref = new DocumentReferenceImpl<U>(
      this.firestore,
      this.path,
      this.parent as unknown as CollectionReference<U>
    )
    ;(ref as any)._converter = converter
    return ref
  }
}

class CollectionReferenceImpl<T = DocumentData> implements CollectionReference<T> {
  readonly id: string
  readonly path: string
  readonly firestore: Firestore
  readonly type = 'collection' as const
  readonly parent: DocumentReference<DocumentData> | null
  private _converter: FirestoreDataConverter<T> | null = null

  constructor(firestore: Firestore, path: string, parent: DocumentReference<DocumentData> | null = null) {
    this.firestore = firestore
    this.path = path
    this.id = path.split('/').pop()!
    this.parent = parent
  }

  doc(documentPath?: string): DocumentReference<T> {
    const docId = documentPath ?? generateAutoId()
    return new DocumentReferenceImpl(this.firestore, `${this.path}/${docId}`, this)
  }

  withConverter<U>(converter: FirestoreDataConverter<U>): CollectionReference<U>
  withConverter(converter: null): CollectionReference<DocumentData>
  withConverter<U>(converter: FirestoreDataConverter<U> | null): CollectionReference<U> | CollectionReference<DocumentData> {
    const ref = new CollectionReferenceImpl<U>(
      this.firestore,
      this.path,
      this.parent
    )
    ;(ref as any)._converter = converter
    return ref
  }
}

/**
 * Get a collection reference
 */
export function collection(firestore: Firestore, path: string): CollectionReference<DocumentData> {
  const parts = path.split('/')

  // Odd number of parts = collection (e.g., "users" or "users/alice/posts")
  // Even number of parts = invalid (would be a document path)
  if (parts.length > 1 && parts.length % 2 === 1) {
    // This is a subcollection (e.g., "users/alice/posts")
    // Parent is the document before it (e.g., "users/alice")
    const parentDocPath = parts.slice(0, -1).join('/')
    const parentColPath = parts.slice(0, -2).join('/')
    const parentCol = new CollectionReferenceImpl<DocumentData>(firestore, parentColPath, null)
    const parentDoc = new DocumentReferenceImpl<DocumentData>(firestore, parentDocPath, parentCol)
    return new CollectionReferenceImpl(firestore, path, parentDoc)
  }

  return new CollectionReferenceImpl(firestore, path, null)
}

/**
 * Get a document reference
 */
export function doc(firestore: Firestore, path: string): DocumentReference<DocumentData> {
  const parts = path.split('/')
  const collectionPath = parts.slice(0, -1).join('/')
  const col = new CollectionReferenceImpl<DocumentData>(firestore, collectionPath, null)
  return new DocumentReferenceImpl(firestore, path, col)
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

function createMetadata(): SnapshotMetadata {
  return {
    fromCache: false,
    hasPendingWrites: false,
    isEqual(other: SnapshotMetadata): boolean {
      return this.fromCache === other.fromCache && this.hasPendingWrites === other.hasPendingWrites
    },
  }
}

function createDocumentSnapshot<T = DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData | undefined,
  exists: boolean
): DocumentSnapshot<T> {
  return {
    exists,
    id: ref.id,
    ref,
    metadata: createMetadata(),
    data(_options?: SnapshotOptions): T | undefined {
      return data as T | undefined
    },
    get(fieldPath: string | FieldPath, _options?: SnapshotOptions): unknown {
      if (!data) return undefined
      const path = typeof fieldPath === 'string' ? fieldPath : ''
      const parts = path.split('.')
      let current: unknown = data
      for (const part of parts) {
        if (current == null) return undefined
        if (typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[part]
      }
      return current
    },
  }
}

function createQueryDocumentSnapshot<T = DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData
): QueryDocumentSnapshot<T> {
  const snapshot = createDocumentSnapshot(ref, data, true)
  return {
    ...snapshot,
    exists: true as const,
    data(_options?: SnapshotOptions): T {
      return data as T
    },
  }
}

/**
 * Add a document to a collection with auto-generated ID
 */
export async function addDoc<T extends DocumentData>(
  reference: CollectionReference<T>,
  data: T
): Promise<DocumentReference<T>> {
  const docRef = reference.doc()
  const storage = (reference.firestore as FirestoreImpl)._storage

  // Process field values
  const processedData = processFieldValues(data)
  storage.setDocument(docRef.path, processedData)

  return docRef
}

/**
 * Set document data
 */
export async function setDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: T,
  options?: SetOptions
): Promise<void> {
  const storage = (reference.firestore as FirestoreImpl)._storage

  // For merge operations, get existing data to properly apply FieldValue operations
  let existingData: DocumentData | undefined
  if (options?.merge || options?.mergeFields) {
    const existing = storage.getDocument(reference.path)
    existingData = existing?.data
  }

  const processedData = processFieldValues(data, existingData)

  // Collect fields marked for deletion
  const fieldsToDelete: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__type__' in value && (value as any).__type__ === 'delete') {
      fieldsToDelete.push(key)
    }
  }

  storage.setDocument(reference.path, processedData, options, fieldsToDelete.length > 0 ? fieldsToDelete : undefined)
}

/**
 * Get a document
 */
export async function getDoc<T extends DocumentData>(
  reference: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  const storage = (reference.firestore as FirestoreImpl)._storage
  const doc = storage.getDocument(reference.path)

  return createDocumentSnapshot(
    reference,
    doc?.data,
    !!doc
  )
}

/**
 * Get documents from a query
 */
export async function getDocs<T extends DocumentData>(
  queryRef: Query<T>
): Promise<QuerySnapshot<T>> {
  const storage = ((queryRef as QueryImpl<T>).firestore as FirestoreImpl)._storage

  // Handle CollectionReference (which extends Query but doesn't have _constraints)
  const isCollection = queryRef instanceof CollectionReferenceImpl
  const collectionPath = isCollection
    ? (queryRef as CollectionReferenceImpl<T>).path
    : (queryRef as QueryImpl<T>)._collectionPath
  const constraints = isCollection
    ? []
    : (queryRef as QueryImpl<T>)._constraints ?? []

  const results = storage.queryCollection(collectionPath, constraints)

  const docs = results.map((result) => {
    const docRef = new DocumentReferenceImpl<T>(
      queryRef.firestore,
      `${collectionPath}/${result.id}`,
      null as any
    )
    return createQueryDocumentSnapshot(docRef, result.data)
  })

  return {
    query: queryRef,
    docs,
    size: docs.length,
    empty: docs.length === 0,
    metadata: createMetadata(),
    forEach(callback: (result: QueryDocumentSnapshot<T>) => void): void {
      docs.forEach(callback)
    },
    docChanges(): DocumentChange<T>[] {
      return docs.map((doc, index) => ({
        type: 'added' as const,
        doc,
        oldIndex: -1,
        newIndex: index,
      }))
    },
  }
}

/**
 * Update document fields
 */
export async function updateDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: UpdateData<T>
): Promise<void> {
  const storage = (reference.firestore as FirestoreImpl)._storage
  // Don't process field values here - let updateDocument handle them
  // This is important because field values like increment need the existing value
  storage.updateDocument(reference.path, data as DocumentData)
}

/**
 * Delete a document
 */
export async function deleteDoc(reference: DocumentReference<unknown>): Promise<void> {
  const storage = (reference.firestore as FirestoreImpl)._storage
  storage.deleteDocument(reference.path)
}

// ============================================================================
// QUERY IMPLEMENTATION
// ============================================================================

class QueryImpl<T = DocumentData> implements Query<T> {
  readonly firestore: Firestore
  readonly type: 'query' | 'collection'
  readonly _collectionPath: string
  readonly _constraints: QueryConstraint[]

  constructor(
    firestore: Firestore,
    collectionPath: string,
    constraints: QueryConstraint[] = [],
    type: 'query' | 'collection' = 'query'
  ) {
    this.firestore = firestore
    this._collectionPath = collectionPath
    this._constraints = constraints
    this.type = type
  }

  withConverter<U>(converter: FirestoreDataConverter<U>): Query<U>
  withConverter(converter: null): Query<DocumentData>
  withConverter<U>(converter: FirestoreDataConverter<U> | null): Query<U> | Query<DocumentData> {
    return new QueryImpl<U>(
      this.firestore,
      this._collectionPath,
      this._constraints,
      this.type
    )
  }
}

/**
 * Create a query
 */
export function query<T extends DocumentData>(
  queryRef: Query<T>,
  ...constraints: QueryConstraint[]
): Query<T> {
  const q = queryRef as QueryImpl<T> | CollectionReferenceImpl<T>
  const collectionPath = q instanceof CollectionReferenceImpl ? q.path : q._collectionPath
  const existingConstraints = q instanceof QueryImpl ? q._constraints : []

  return new QueryImpl(
    q.firestore,
    collectionPath,
    [...existingConstraints, ...constraints],
    'query'
  )
}

/**
 * Create a where constraint
 */
export function where(
  fieldPath: string | FieldPath,
  opStr: WhereFilterOp,
  value: unknown
): QueryWhereConstraint {
  return {
    type: 'where',
    _field: fieldPath,
    _op: opStr,
    _value: value,
  }
}

/**
 * Create an orderBy constraint
 */
export function orderBy(
  fieldPath: string | FieldPath,
  directionStr: OrderByDirection = 'asc'
): QueryOrderByConstraint {
  return {
    type: 'orderBy',
    _field: fieldPath,
    _direction: directionStr,
  }
}

/**
 * Create a limit constraint
 */
export function limit(limitCount: number): QueryLimitConstraint {
  return {
    type: 'limit',
    _limit: limitCount,
  }
}

/**
 * Create a limitToLast constraint
 */
export function limitToLast(limitCount: number): QueryLimitConstraint {
  return {
    type: 'limitToLast',
    _limit: limitCount,
  }
}

/**
 * Create a startAt constraint
 */
export function startAt(...values: unknown[]): QueryCursorConstraint {
  return {
    type: 'startAt',
    _values: values,
  }
}

/**
 * Create a startAfter constraint
 */
export function startAfter(...values: unknown[]): QueryCursorConstraint {
  return {
    type: 'startAfter',
    _values: values,
  }
}

/**
 * Create an endAt constraint
 */
export function endAt(...values: unknown[]): QueryCursorConstraint {
  return {
    type: 'endAt',
    _values: values,
  }
}

/**
 * Create an endBefore constraint
 */
export function endBefore(...values: unknown[]): QueryCursorConstraint {
  return {
    type: 'endBefore',
    _values: values,
  }
}

// ============================================================================
// REAL-TIME LISTENERS
// ============================================================================

/**
 * Listen to document or query snapshots
 */
export function onSnapshot<T extends DocumentData>(
  reference: DocumentReference<T> | Query<T>,
  optionsOrOnNext: SnapshotListenOptions | ((snapshot: DocumentSnapshot<T> | QuerySnapshot<T>) => void),
  onNextOrOnError?: ((snapshot: DocumentSnapshot<T> | QuerySnapshot<T>) => void) | ((error: Error) => void),
  onError?: (error: Error) => void
): Unsubscribe {
  let callback: (snapshot: DocumentSnapshot<T> | QuerySnapshot<T>) => void
  let errorCallback: ((error: Error) => void) | undefined

  if (typeof optionsOrOnNext === 'function') {
    callback = optionsOrOnNext
    errorCallback = onNextOrOnError as ((error: Error) => void) | undefined
  } else {
    callback = onNextOrOnError as (snapshot: DocumentSnapshot<T> | QuerySnapshot<T>) => void
    errorCallback = onError
  }

  const storage = (reference.firestore as FirestoreImpl)._storage

  // Initial snapshot
  const sendSnapshot = async () => {
    try {
      if ('type' in reference && reference.type === 'document') {
        const snap = await getDoc(reference as DocumentReference<T>)
        callback(snap)
      } else {
        const snap = await getDocs(reference as Query<T>)
        callback(snap)
      }
    } catch (error) {
      errorCallback?.(error as Error)
    }
  }

  // Send initial snapshot
  setTimeout(sendSnapshot, 0)

  // Set up listener - determine the correct path based on reference type
  let path: string
  if (reference instanceof DocumentReferenceImpl) {
    path = reference.path
  } else if (reference instanceof CollectionReferenceImpl) {
    path = reference.path
  } else {
    path = (reference as QueryImpl<T>)._collectionPath
  }

  const unsubscribe = storage.addListener(path, sendSnapshot)

  return unsubscribe
}

// ============================================================================
// WRITE BATCH
// ============================================================================

class WriteBatchImpl implements WriteBatch {
  private firestore: FirestoreImpl
  private operations: Array<{ type: 'set' | 'update' | 'delete'; ref: DocumentReference<any>; data?: any; options?: SetOptions }> = []

  constructor(firestore: Firestore) {
    this.firestore = firestore as FirestoreImpl
  }

  set<T>(documentRef: DocumentReference<T>, data: T, options?: SetOptions): WriteBatch {
    this.operations.push({ type: 'set', ref: documentRef, data, options })
    return this
  }

  update<T>(documentRef: DocumentReference<T>, data: UpdateData<T>): WriteBatch
  update<T>(documentRef: DocumentReference<T>, field: string | FieldPath, value: unknown, ...moreFieldsAndValues: unknown[]): WriteBatch
  update<T>(documentRef: DocumentReference<T>, dataOrField: UpdateData<T> | string | FieldPath, ...rest: unknown[]): WriteBatch {
    if (typeof dataOrField === 'string' || (dataOrField as any)?._segments) {
      // Field path variant
      const data: Record<string, unknown> = {}
      const fieldName = typeof dataOrField === 'string' ? dataOrField : ''
      data[fieldName] = rest[0]
      for (let i = 1; i < rest.length; i += 2) {
        const fn = typeof rest[i] === 'string' ? rest[i] : ''
        data[fn as string] = rest[i + 1]
      }
      this.operations.push({ type: 'update', ref: documentRef, data })
    } else {
      this.operations.push({ type: 'update', ref: documentRef, data: dataOrField })
    }
    return this
  }

  delete(documentRef: DocumentReference<unknown>): WriteBatch {
    this.operations.push({ type: 'delete', ref: documentRef })
    return this
  }

  async commit(): Promise<void> {
    for (const op of this.operations) {
      switch (op.type) {
        case 'set':
          await setDoc(op.ref, op.data, op.options)
          break
        case 'update':
          await updateDoc(op.ref, op.data)
          break
        case 'delete':
          await deleteDoc(op.ref)
          break
      }
    }
  }
}

/**
 * Create a write batch
 */
export function writeBatch(firestore: Firestore): WriteBatch {
  return new WriteBatchImpl(firestore)
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

class TransactionImpl implements Transaction {
  private firestore: FirestoreImpl
  private reads = new Map<string, DocumentSnapshot<any>>()
  private writes: Array<{ type: 'set' | 'update' | 'delete'; ref: DocumentReference<any>; data?: any; options?: SetOptions }> = []

  constructor(firestore: Firestore) {
    this.firestore = firestore as FirestoreImpl
  }

  async get<T>(documentRef: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    const snap = await getDoc(documentRef)
    this.reads.set(documentRef.path, snap)
    return snap as DocumentSnapshot<T>
  }

  set<T>(documentRef: DocumentReference<T>, data: T, options?: SetOptions): Transaction {
    this.writes.push({ type: 'set', ref: documentRef, data, options })
    return this
  }

  update<T>(documentRef: DocumentReference<T>, data: UpdateData<T>): Transaction
  update<T>(documentRef: DocumentReference<T>, field: string | FieldPath, value: unknown, ...moreFieldsAndValues: unknown[]): Transaction
  update<T>(documentRef: DocumentReference<T>, dataOrField: UpdateData<T> | string | FieldPath, ...rest: unknown[]): Transaction {
    if (typeof dataOrField === 'string' || (dataOrField as any)?._segments) {
      const data: Record<string, unknown> = {}
      const fieldName = typeof dataOrField === 'string' ? dataOrField : ''
      data[fieldName] = rest[0]
      for (let i = 1; i < rest.length; i += 2) {
        const fn = typeof rest[i] === 'string' ? rest[i] : ''
        data[fn as string] = rest[i + 1]
      }
      this.writes.push({ type: 'update', ref: documentRef, data })
    } else {
      this.writes.push({ type: 'update', ref: documentRef, data: dataOrField })
    }
    return this
  }

  delete(documentRef: DocumentReference<unknown>): Transaction {
    this.writes.push({ type: 'delete', ref: documentRef })
    return this
  }

  async _commit(): Promise<void> {
    for (const op of this.writes) {
      switch (op.type) {
        case 'set':
          await setDoc(op.ref, op.data, op.options)
          break
        case 'update':
          await updateDoc(op.ref, op.data)
          break
        case 'delete':
          await deleteDoc(op.ref)
          break
      }
    }
  }
}

/**
 * Run a transaction
 */
export async function runTransaction<T>(
  firestore: Firestore,
  updateFunction: (transaction: Transaction) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transaction = new TransactionImpl(firestore)
    try {
      const result = await updateFunction(transaction)
      await transaction._commit()
      return result
    } catch (error) {
      lastError = error as Error
      // Only retry on contention errors
      if ((error as FirestoreError).code !== 'aborted') {
        throw error
      }
    }
  }

  throw lastError
}

// ============================================================================
// FIELD VALUES
// ============================================================================

interface ServerTimestampValue extends FieldValue {
  __type__: 'serverTimestamp'
}

interface DeleteFieldValueImpl extends FieldValue {
  __type__: 'delete'
}

interface IncrementFieldValueImpl extends FieldValue {
  __type__: 'increment'
  _operand: number
}

interface ArrayUnionFieldValueImpl extends FieldValue {
  __type__: 'arrayUnion'
  _elements: unknown[]
}

interface ArrayRemoveFieldValueImpl extends FieldValue {
  __type__: 'arrayRemove'
  _elements: unknown[]
}

/**
 * Create a server timestamp field value
 */
export function serverTimestamp(): FieldValue {
  return {
    __type__: 'serverTimestamp',
    isEqual(other: FieldValue): boolean {
      return (other as any).__type__ === 'serverTimestamp'
    },
  } as ServerTimestampValue
}

/**
 * Create a delete field value
 */
export function deleteField(): FieldValue {
  return {
    __type__: 'delete',
    isEqual(other: FieldValue): boolean {
      return (other as any).__type__ === 'delete'
    },
  } as DeleteFieldValueImpl
}

/**
 * Create an increment field value
 */
export function increment(n: number): FieldValue {
  return {
    __type__: 'increment',
    _operand: n,
    isEqual(other: FieldValue): boolean {
      return (other as any).__type__ === 'increment' && (other as any)._operand === n
    },
  } as IncrementFieldValueImpl
}

/**
 * Create an array union field value
 */
export function arrayUnion(...elements: unknown[]): FieldValue {
  return {
    __type__: 'arrayUnion',
    _elements: elements,
    isEqual(other: FieldValue): boolean {
      return (other as any).__type__ === 'arrayUnion'
    },
  } as ArrayUnionFieldValueImpl
}

/**
 * Create an array remove field value
 */
export function arrayRemove(...elements: unknown[]): FieldValue {
  return {
    __type__: 'arrayRemove',
    _elements: elements,
    isEqual(other: FieldValue): boolean {
      return (other as any).__type__ === 'arrayRemove'
    },
  } as ArrayRemoveFieldValueImpl
}

/**
 * Process field values in data before storage
 * @param data - The new data with potential FieldValue sentinels
 * @param existingData - Optional existing document data for merge operations
 */
function processFieldValues(data: DocumentData, existingData?: DocumentData): DocumentData {
  const result: DocumentData = {}

  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__type__' in value) {
      const fv = value as any
      switch (fv.__type__) {
        case 'serverTimestamp':
          result[key] = Timestamp.now()
          break
        case 'delete':
          // Don't include this field (mark for deletion)
          break
        case 'increment': {
          const existingValue = existingData?.[key]
          const base = typeof existingValue === 'number' ? existingValue : 0
          result[key] = base + fv._operand
          break
        }
        case 'arrayUnion': {
          const existingArray = existingData?.[key]
          const arr = Array.isArray(existingArray) ? [...existingArray] : []
          for (const elem of fv._elements) {
            if (!arr.includes(elem)) {
              arr.push(elem)
            }
          }
          result[key] = arr
          break
        }
        case 'arrayRemove': {
          const existingArray = existingData?.[key]
          const arr = Array.isArray(existingArray) ? [...existingArray] : []
          result[key] = arr.filter((item: unknown) => !fv._elements.includes(item))
          break
        }
        default:
          result[key] = value
      }
    } else {
      result[key] = value
    }
  }

  return result
}

// ============================================================================
// TIMESTAMP CLASS
// ============================================================================

export class Timestamp implements TimestampType {
  readonly seconds: number
  readonly nanoseconds: number

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }

  static now(): Timestamp {
    const now = Date.now()
    return new Timestamp(Math.floor(now / 1000), (now % 1000) * 1_000_000)
  }

  static fromDate(date: Date): Timestamp {
    const ms = date.getTime()
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1_000_000)
  }

  static fromMillis(milliseconds: number): Timestamp {
    return new Timestamp(Math.floor(milliseconds / 1000), (milliseconds % 1000) * 1_000_000)
  }

  toDate(): Date {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000)
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000)
  }

  isEqual(other: Timestamp): boolean {
    return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds
  }

  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds }
  }

  toString(): string {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`
  }

  valueOf(): string {
    return `${this.seconds}.${String(this.nanoseconds).padStart(9, '0')}`
  }
}

// ============================================================================
// GEOPOINT CLASS
// ============================================================================

export class GeoPoint implements GeoPointType {
  readonly latitude: number
  readonly longitude: number

  constructor(latitude: number, longitude: number) {
    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90')
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180')
    }
    this.latitude = latitude
    this.longitude = longitude
  }

  isEqual(other: GeoPoint): boolean {
    return this.latitude === other.latitude && this.longitude === other.longitude
  }

  toJSON(): { latitude: number; longitude: number } {
    return { latitude: this.latitude, longitude: this.longitude }
  }
}

// ============================================================================
// FIELDPATH CLASS
// ============================================================================

export class FieldPath implements IFieldPath {
  private _segments: string[]

  constructor(...fieldNames: string[]) {
    this._segments = fieldNames
  }

  isEqual(other: IFieldPath): boolean {
    const otherSegments = (other as FieldPath)._segments
    return (
      this._segments.length === otherSegments.length &&
      this._segments.every((s, i) => s === otherSegments[i])
    )
  }
}

/**
 * Get the document ID field path
 */
export function documentId(): FieldPath {
  const path = new FieldPath('__name__')
  ;(path as any).__type__ = 'documentId'
  return path
}

// ============================================================================
// BYTES CLASS
// ============================================================================

export class Bytes implements BytesType {
  private _bytes: Uint8Array

  private constructor(bytes: Uint8Array) {
    this._bytes = bytes
  }

  static fromBase64String(base64: string): Bytes {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Bytes(bytes)
  }

  static fromUint8Array(array: Uint8Array): Bytes {
    return new Bytes(new Uint8Array(array))
  }

  toBase64(): string {
    let binary = ''
    for (let i = 0; i < this._bytes.length; i++) {
      binary += String.fromCharCode(this._bytes[i]!)
    }
    return btoa(binary)
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this._bytes)
  }

  isEqual(other: Bytes): boolean {
    const otherBytes = (other as Bytes)._bytes
    if (this._bytes.length !== otherBytes.length) return false
    for (let i = 0; i < this._bytes.length; i++) {
      if (this._bytes[i] !== otherBytes[i]) return false
    }
    return true
  }
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Get count from server
 */
export async function getCountFromServer<T extends DocumentData>(
  query: Query<T>
): Promise<AggregateQuerySnapshot<{ count: AggregateField<number> }>> {
  const snapshot = await getDocs(query)
  return {
    query: { query, type: 'AggregateQuery' },
    data() {
      return { count: snapshot.size }
    },
  }
}

/**
 * Get aggregates from server
 */
export async function getAggregateFromServer<T extends AggregateSpec>(
  query: Query<DocumentData>,
  aggregateSpec: T
): Promise<AggregateQuerySnapshot<T>> {
  const snapshot = await getDocs(query)

  const results: Record<string, number> = {}

  for (const [key, spec] of Object.entries(aggregateSpec)) {
    const field = spec as AggregateField<unknown>

    switch (field.aggregateType) {
      case 'count':
        results[key] = snapshot.size
        break
      case 'sum': {
        const fieldName = (field as any)._field ?? ''
        results[key] = snapshot.docs.reduce((sum, doc) => {
          const val = doc.data()[fieldName]
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)
        break
      }
      case 'avg': {
        const fieldName = (field as any)._field ?? ''
        const values = snapshot.docs
          .map((doc) => doc.data()[fieldName])
          .filter((v) => typeof v === 'number') as number[]
        results[key] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
        break
      }
    }
  }

  return {
    query: { query, type: 'AggregateQuery' },
    data() {
      return results as any
    },
  }
}

/**
 * Create a count aggregate field
 */
export function count(): AggregateField<number> {
  return {
    aggregateType: 'count',
    _type: 0,
  }
}

/**
 * Create a sum aggregate field
 */
export function sum(field: string): AggregateField<number> {
  return {
    aggregateType: 'sum',
    _type: 0,
    _field: field,
  } as AggregateField<number> & { _field: string }
}

/**
 * Create an average aggregate field
 */
export function average(field: string): AggregateField<number> {
  return {
    aggregateType: 'avg',
    _type: 0,
    _field: field,
  } as AggregateField<number> & { _field: string }
}

// ============================================================================
// PERSISTENCE (no-op for in-memory)
// ============================================================================

export async function enableIndexedDbPersistence(_firestore: Firestore): Promise<void> {
  // No-op for in-memory implementation
}

export async function enableMultiTabIndexedDbPersistence(_firestore: Firestore): Promise<void> {
  // No-op for in-memory implementation
}

export async function clearIndexedDbPersistence(_firestore: Firestore): Promise<void> {
  // No-op for in-memory implementation
}

export async function waitForPendingWrites(_firestore: Firestore): Promise<void> {
  // No-op for in-memory implementation
}

export async function terminate(firestore: Firestore): Promise<void> {
  (firestore as FirestoreImpl).terminate()
}

// ============================================================================
// REALTIME DATABASE IMPLEMENTATION
// ============================================================================

class InMemoryRealtimeDB {
  private data = new Map<string, unknown>()
  private priorities = new Map<string, string | number | null>()
  private listeners = new Map<string, Set<{ type: string; callback: (snapshot: DataSnapshot) => void }>>()
  private online = true

  get(path: string): unknown {
    const normalizedPath = this.normalizePath(path)

    // First, check if we have a direct value at this path
    if (this.data.has(normalizedPath)) {
      return this.data.get(normalizedPath)
    }

    // Otherwise, construct the value from child paths
    const result: Record<string, unknown> = {}
    const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'

    for (const [storedPath, value] of this.data.entries()) {
      if (normalizedPath === '/') {
        // For root, we need the first segment of each path
        if (storedPath !== '/') {
          const parts = storedPath.split('/').filter(Boolean)
          if (parts.length > 0) {
            const childKey = parts[0]!
            if (parts.length === 1) {
              result[childKey] = value
            } else if (!(childKey in result)) {
              // Recursively get the child
              result[childKey] = this.get('/' + childKey)
            }
          }
        }
      } else if (storedPath.startsWith(prefix)) {
        // Get the relative path after the prefix
        const relativePath = storedPath.slice(prefix.length)
        const parts = relativePath.split('/').filter(Boolean)
        if (parts.length === 1) {
          result[parts[0]!] = value
        } else if (parts.length > 1 && !(parts[0]! in result)) {
          // Recursively get the child
          result[parts[0]!] = this.get(normalizedPath + '/' + parts[0]!)
        }
      }
    }

    return Object.keys(result).length > 0 ? result : undefined
  }

  set(path: string, value: unknown): void {
    const normalizedPath = this.normalizePath(path)
    this.data.set(normalizedPath, value)
    this.notifyListeners(normalizedPath, 'value')

    // Notify parent of child changes
    const parentPath = this.getParentPath(normalizedPath)
    if (parentPath) {
      this.notifyListeners(parentPath, 'child_added')
    }
  }

  update(path: string, values: Record<string, unknown>): void {
    const normalizedPath = this.normalizePath(path)
    const existing = this.get(normalizedPath) as Record<string, unknown> | undefined

    // Handle multi-path updates
    for (const [key, value] of Object.entries(values)) {
      if (key.includes('/')) {
        // Multi-path update - need to properly merge into nested path
        // e.g., 'users/alice/age' -> merge 'age' into '/users/alice'
        const parts = key.split('/')
        const targetPath = normalizedPath === '/'
          ? '/' + parts.slice(0, -1).join('/')
          : normalizedPath + '/' + parts.slice(0, -1).join('/')
        const normalizedTargetPath = this.normalizePath(targetPath)
        const fieldKey = parts[parts.length - 1]!

        // Get existing data at the target path
        const targetExisting = this.get(normalizedTargetPath) as Record<string, unknown> | undefined
        const updated = { ...targetExisting, [fieldKey]: value }
        this.data.set(normalizedTargetPath, updated)
      } else {
        // Single field update - merge into the existing object at this path
        const updated = { ...existing, [key]: value }
        this.data.set(normalizedPath, updated)
      }
    }

    this.notifyListeners(normalizedPath, 'value')
    this.notifyListeners(normalizedPath, 'child_changed')
  }

  remove(path: string): void {
    const normalizedPath = this.normalizePath(path)
    const parentPath = this.getParentPath(normalizedPath)

    // Remove this path and all children
    const toDelete: string[] = []
    for (const storedPath of this.data.keys()) {
      if (storedPath === normalizedPath || storedPath.startsWith(normalizedPath + '/')) {
        toDelete.push(storedPath)
      }
    }
    for (const p of toDelete) {
      this.data.delete(p)
    }

    this.notifyListeners(normalizedPath, 'value')

    if (parentPath) {
      this.notifyListeners(parentPath, 'child_removed')
    }
  }

  setPriority(path: string, priority: string | number | null): void {
    this.priorities.set(this.normalizePath(path), priority)
  }

  getPriority(path: string): string | number | null {
    return this.priorities.get(this.normalizePath(path)) ?? null
  }

  addListener(
    path: string,
    type: string,
    callback: (snapshot: DataSnapshot) => void
  ): () => void {
    const normalizedPath = this.normalizePath(path)
    const key = normalizedPath

    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }

    const listener = { type, callback }
    this.listeners.get(key)!.add(listener)

    return () => {
      this.listeners.get(key)?.delete(listener)
    }
  }

  removeListener(path: string, type: string, callback?: (snapshot: DataSnapshot) => void): void {
    const normalizedPath = this.normalizePath(path)
    const listeners = this.listeners.get(normalizedPath)

    if (listeners) {
      if (callback) {
        for (const listener of listeners) {
          if (listener.type === type && listener.callback === callback) {
            listeners.delete(listener)
            break
          }
        }
      } else {
        // Remove all listeners of this type
        for (const listener of listeners) {
          if (listener.type === type) {
            listeners.delete(listener)
          }
        }
      }
    }
  }

  hasListener(path: string, type: string, callback: (snapshot: DataSnapshot) => void): boolean {
    const normalizedPath = this.normalizePath(path)
    const listeners = this.listeners.get(normalizedPath)
    if (!listeners) return false

    for (const listener of listeners) {
      if (listener.type === type && listener.callback === callback) {
        return true
      }
    }
    return false
  }

  goOnline(): void {
    this.online = true
  }

  goOffline(): void {
    this.online = false
  }

  private notifyListeners(path: string, type: string): void {
    const listeners = this.listeners.get(path)
    if (listeners) {
      for (const listener of listeners) {
        if (listener.type === type || listener.type === 'value') {
          const snapshot = this.createSnapshot(path)
          setTimeout(() => listener.callback(snapshot), 0)
        }
      }
    }
  }

  createSnapshot(path: string): DataSnapshot {
    const normalizedPath = this.normalizePath(path)
    const value = this.get(normalizedPath)
    const key = normalizedPath === '/' ? null : (normalizedPath.split('/').pop() ?? null)

    return new DataSnapshotImpl(this, normalizedPath, key, value)
  }

  private normalizePath(path: string): string {
    return '/' + path.split('/').filter(Boolean).join('/')
  }

  private getParentPath(path: string): string | null {
    const parts = path.split('/').filter(Boolean)
    if (parts.length <= 1) return null
    return '/' + parts.slice(0, -1).join('/')
  }
}

class DataSnapshotImpl implements DataSnapshot {
  private db: InMemoryRealtimeDB
  private path: string
  readonly key: string | null
  private value: unknown
  readonly ref: DatabaseReference

  constructor(db: InMemoryRealtimeDB, path: string, key: string | null, value: unknown) {
    this.db = db
    this.path = path
    this.key = key
    this.value = value
    this.ref = null as any // Will be set by caller
  }

  get size(): number {
    if (this.value && typeof this.value === 'object') {
      return Object.keys(this.value).length
    }
    return 0
  }

  exists(): boolean {
    return this.value !== undefined && this.value !== null
  }

  val(): unknown {
    return this.value ?? null
  }

  exportVal(): unknown {
    return this.value
  }

  hasChildren(): boolean {
    return this.value !== null && typeof this.value === 'object' && Object.keys(this.value).length > 0
  }

  hasChild(path: string): boolean {
    if (!this.value || typeof this.value !== 'object') return false
    const parts = path.split('/')
    let current: unknown = this.value
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return false
      if (!(part in current)) return false
      current = (current as Record<string, unknown>)[part]
    }
    return true
  }

  child(path: string): DataSnapshot {
    let value: unknown = this.value
    if (value && typeof value === 'object') {
      const parts = path.split('/')
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part]
        } else {
          value = null
          break
        }
      }
    } else {
      value = null
    }

    const key = path.split('/').pop() ?? null
    return new DataSnapshotImpl(this.db, `${this.path}/${path}`, key, value)
  }

  forEach(callback: (child: DataSnapshot) => boolean | void): boolean {
    if (!this.value || typeof this.value !== 'object') return false

    for (const [key, value] of Object.entries(this.value)) {
      const childSnap = new DataSnapshotImpl(this.db, `${this.path}/${key}`, key, value)
      const result = callback(childSnap)
      if (result === true) return true
    }
    return false
  }

  getPriority(): string | number | null {
    return this.db.getPriority(this.path)
  }

  toJSON(): Record<string, unknown> | null {
    if (this.value && typeof this.value === 'object') {
      return this.value as Record<string, unknown>
    }
    return null
  }
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

class DatabaseImpl implements Database {
  readonly app: FirebaseApp
  readonly type = 'database' as const
  readonly url: string
  readonly _storage = new InMemoryRealtimeDB()

  constructor(app: FirebaseApp) {
    this.app = app
    this.url = app.options.databaseURL ?? `https://${app.options.projectId}.firebaseio.com`
  }
}

/**
 * Get Database instance for an app
 */
export function getDatabase(app?: FirebaseApp): Database {
  const resolvedApp = app ?? getApp()

  if (!databaseInstances.has(resolvedApp.name)) {
    databaseInstances.set(resolvedApp.name, new DatabaseImpl(resolvedApp))
  }

  return databaseInstances.get(resolvedApp.name)!
}

// ============================================================================
// DATABASE REFERENCE
// ============================================================================

let pushIdCounter = 0

function generatePushId(): string {
  return `-${Date.now().toString(36)}${(++pushIdCounter).toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

class DatabaseReferenceImpl implements DatabaseReference {
  readonly key: string | null
  readonly path: string
  readonly database: Database
  readonly parent: DatabaseReference | null
  readonly root: DatabaseReference

  constructor(database: Database, path: string) {
    this.database = database
    this.path = '/' + path.split('/').filter(Boolean).join('/')
    this.key = this.path === '/' ? null : this.path.split('/').pop() ?? null

    const parentPath = this.path.split('/').filter(Boolean).slice(0, -1).join('/')
    this.parent = this.path === '/' || this.path === ''
      ? null
      : new DatabaseReferenceImpl(database, parentPath || '/')

    this.root = this.path === '/' ? this : new DatabaseReferenceImpl(database, '/')
  }

  child(path: string): DatabaseReference {
    const childPath = this.path === '/' ? path : `${this.path}/${path}`
    return new DatabaseReferenceImpl(this.database, childPath)
  }

  push(): ThenableReference {
    const newKey = generatePushId()
    const newRef = this.child(newKey) as DatabaseReferenceImpl

    // Create thenable reference
    const thenableRef = Object.assign(newRef, {
      then: (resolve: (ref: DatabaseReference) => void) => {
        resolve(newRef)
        return Promise.resolve(newRef)
      },
      catch: () => Promise.resolve(newRef),
      finally: (fn: () => void) => {
        fn()
        return Promise.resolve(newRef)
      },
      [Symbol.toStringTag]: 'Promise',
    }) as ThenableReference

    return thenableRef
  }

  toString(): string {
    return `${this.database.url}${this.path}`
  }

  isEqual(other: DatabaseReference | null): boolean {
    if (!other) return false
    return this.path === other.path && this.database === other.database
  }
}

/**
 * Get a database reference
 */
export function ref(database: Database, path?: string): DatabaseReference {
  return new DatabaseReferenceImpl(database, path ?? '/')
}

/**
 * Get a child reference
 */
export function child(parent: DatabaseReference, path: string): DatabaseReference {
  return parent.child(path)
}

/**
 * Push a new child
 */
export function push(parent: DatabaseReference): ThenableReference {
  return parent.push()
}

/**
 * Create a ref from URL
 */
export function refFromURL(database: Database, url: string): DatabaseReference {
  const baseUrl = database.url
  if (!url.startsWith(baseUrl)) {
    throw new Error(`URL does not match database URL: ${url}`)
  }
  const path = url.slice(baseUrl.length)
  return ref(database, path)
}

// ============================================================================
// DATABASE CRUD
// ============================================================================

/**
 * Set data at a reference
 */
export async function set(reference: DatabaseReference, value: unknown): Promise<void> {
  const storage = (reference.database as DatabaseImpl)._storage
  storage.set(reference.path, value)
}

/**
 * Get data from a reference
 */
export async function get(reference: DatabaseReference | DatabaseQueryImpl): Promise<DataSnapshot> {
  const db = reference instanceof DatabaseQueryImpl
    ? reference._ref.database
    : reference.database
  const storage = (db as DatabaseImpl)._storage
  const path = reference instanceof DatabaseQueryImpl ? reference._ref.path : reference.path

  let snapshot = storage.createSnapshot(path)

  // Apply query constraints if this is a query
  if (reference instanceof DatabaseQueryImpl) {
    snapshot = applyDatabaseQueryConstraints(snapshot, reference._constraints)
  }

  return snapshot
}

/**
 * Update data at a reference
 */
export async function update(reference: DatabaseReference, values: Record<string, unknown>): Promise<void> {
  const storage = (reference.database as DatabaseImpl)._storage
  storage.update(reference.path, values)
}

/**
 * Remove data at a reference
 */
export async function remove(reference: DatabaseReference): Promise<void> {
  const storage = (reference.database as DatabaseImpl)._storage
  storage.remove(reference.path)
}

/**
 * Set data with priority
 */
export async function setWithPriority(
  reference: DatabaseReference,
  value: unknown,
  priority: string | number | null
): Promise<void> {
  const storage = (reference.database as DatabaseImpl)._storage
  storage.set(reference.path, value)
  storage.setPriority(reference.path, priority)
}

/**
 * Set priority
 */
export async function setPriority(
  reference: DatabaseReference,
  priority: string | number | null
): Promise<void> {
  const storage = (reference.database as DatabaseImpl)._storage
  storage.setPriority(reference.path, priority)
}

// ============================================================================
// DATABASE LISTENERS
// ============================================================================

/**
 * Listen for value changes
 */
export function onValue(
  reference: DatabaseReference,
  callback: (snapshot: DataSnapshot) => void,
  cancelCallback?: (error: Error) => void
): Unsubscribe {
  const storage = (reference.database as DatabaseImpl)._storage

  // Add listener first to get the unsubscribe function
  const unsubscribe = storage.addListener(reference.path, 'value', callback)

  // Send initial value (only if listener is still registered)
  setTimeout(() => {
    if (storage.hasListener(reference.path, 'value', callback)) {
      callback(storage.createSnapshot(reference.path))
    }
  }, 0)

  return unsubscribe
}

/**
 * Listen for child added
 */
export function onChildAdded(
  reference: DatabaseReference,
  callback: (snapshot: DataSnapshot, previousChildKey?: string | null) => void,
  cancelCallback?: (error: Error) => void
): Unsubscribe {
  const storage = (reference.database as DatabaseImpl)._storage
  return storage.addListener(reference.path, 'child_added', callback)
}

/**
 * Listen for child changed
 */
export function onChildChanged(
  reference: DatabaseReference,
  callback: (snapshot: DataSnapshot, previousChildKey?: string | null) => void,
  cancelCallback?: (error: Error) => void
): Unsubscribe {
  const storage = (reference.database as DatabaseImpl)._storage
  return storage.addListener(reference.path, 'child_changed', callback)
}

/**
 * Listen for child removed
 */
export function onChildRemoved(
  reference: DatabaseReference,
  callback: (snapshot: DataSnapshot, previousChildKey?: string | null) => void,
  cancelCallback?: (error: Error) => void
): Unsubscribe {
  const storage = (reference.database as DatabaseImpl)._storage
  return storage.addListener(reference.path, 'child_removed', callback)
}

/**
 * Listen for child moved
 */
export function onChildMoved(
  reference: DatabaseReference,
  callback: (snapshot: DataSnapshot, previousChildKey?: string | null) => void,
  cancelCallback?: (error: Error) => void
): Unsubscribe {
  const storage = (reference.database as DatabaseImpl)._storage
  return storage.addListener(reference.path, 'child_moved', callback)
}

/**
 * Remove listener
 */
export function off(
  reference: DatabaseReference,
  eventType?: string,
  callback?: (snapshot: DataSnapshot) => void
): void {
  const storage = (reference.database as DatabaseImpl)._storage
  if (eventType) {
    storage.removeListener(reference.path, eventType, callback)
  }
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

interface DBQueryConstraint {
  type: string
  value?: unknown
  key?: string
}

class DatabaseQueryImpl {
  readonly _ref: DatabaseReference
  readonly _constraints: DBQueryConstraint[]

  constructor(ref: DatabaseReference, constraints: DBQueryConstraint[] = []) {
    this._ref = ref
    this._constraints = constraints
  }
}

/**
 * Create a database query
 */
export function dbQuery(
  reference: DatabaseReference,
  ...constraints: DatabaseQueryConstraint[]
): DatabaseQueryImpl {
  return new DatabaseQueryImpl(reference, constraints as DBQueryConstraint[])
}

/**
 * Order by child key
 */
export function orderByChild(path: string): DatabaseQueryConstraint {
  return { type: 'orderByChild', _path: path } as any
}

/**
 * Order by key
 */
export function orderByKey(): DatabaseQueryConstraint {
  return { type: 'orderByKey' } as any
}

/**
 * Order by value
 */
export function orderByValue(): DatabaseQueryConstraint {
  return { type: 'orderByValue' } as any
}

/**
 * Order by priority
 */
export function orderByPriority(): DatabaseQueryConstraint {
  return { type: 'orderByPriority' } as any
}

/**
 * Limit to first N
 */
export function limitToFirst(limit: number): DatabaseQueryConstraint {
  return { type: 'limitToFirst', _limit: limit } as any
}

/**
 * Limit to last N (RTDB version)
 */
export function rtdbLimitToLast(limit: number): DatabaseQueryConstraint {
  return { type: 'limitToLast', _limit: limit } as any
}

/**
 * Start at value (RTDB version)
 */
export function rtdbStartAt(value: unknown, key?: string): DatabaseQueryConstraint {
  return { type: 'startAt', _value: value, _key: key } as any
}

/**
 * Start after value (RTDB version)
 */
export function rtdbStartAfter(value: unknown, key?: string): DatabaseQueryConstraint {
  return { type: 'startAfter', _value: value, _key: key } as any
}

/**
 * End at value (RTDB version)
 */
export function rtdbEndAt(value: unknown, key?: string): DatabaseQueryConstraint {
  return { type: 'endAt', _value: value, _key: key } as any
}

/**
 * End before value (RTDB version)
 */
export function rtdbEndBefore(value: unknown, key?: string): DatabaseQueryConstraint {
  return { type: 'endBefore', _value: value, _key: key } as any
}

/**
 * Filter to equal value
 */
export function equalTo(value: unknown, key?: string): DatabaseQueryConstraint {
  return { type: 'equalTo', _value: value, _key: key } as any
}

function applyDatabaseQueryConstraints(snapshot: DataSnapshot, constraints: DBQueryConstraint[]): DataSnapshot {
  // Get children as array for sorting/filtering
  let entries: Array<{ key: string; value: unknown; priority: string | number | null }> = []

  snapshot.forEach((child) => {
    entries.push({
      key: child.key!,
      value: child.val(),
      priority: child.getPriority(),
    })
  })

  // Apply constraints
  for (const constraint of constraints) {
    switch (constraint.type) {
      case 'orderByChild': {
        const path = (constraint as any)._path
        entries.sort((a, b) => {
          const aVal = getNestedValue(a.value as Record<string, unknown>, path) as string | number | null
          const bVal = getNestedValue(b.value as Record<string, unknown>, path) as string | number | null
          if (aVal == null && bVal == null) return 0
          if (aVal == null) return 1
          if (bVal == null) return -1
          if (aVal < bVal) return -1
          if (aVal > bVal) return 1
          return 0
        })
        break
      }
      case 'orderByKey':
        entries.sort((a, b) => a.key.localeCompare(b.key))
        break
      case 'orderByValue':
        entries.sort((a, b) => {
          const aValue = a.value as string | number | null
          const bValue = b.value as string | number | null
          if (aValue == null && bValue == null) return 0
          if (aValue == null) return 1
          if (bValue == null) return -1
          if (aValue < bValue) return -1
          if (aValue > bValue) return 1
          return 0
        })
        break
      case 'orderByPriority':
        entries.sort((a, b) => {
          if (a.priority === null && b.priority === null) return 0
          if (a.priority === null) return -1
          if (b.priority === null) return 1
          if (a.priority < b.priority) return -1
          if (a.priority > b.priority) return 1
          return 0
        })
        break
      case 'limitToFirst': {
        const limit = (constraint as any)._limit
        entries = entries.slice(0, limit)
        break
      }
      case 'limitToLast': {
        const limit = (constraint as any)._limit
        entries = entries.slice(-limit)
        break
      }
      case 'startAt': {
        // Support both RTDB format (_value) and Firestore format (_values)
        const value = (constraint as any)._value ?? (constraint as any)._values?.[0]
        // Find first entry where ordered value >= startAt value
        const idx = entries.findIndex((e) => {
          const orderVal = getOrderValue(e, constraints)
          return compareValues(orderVal, value) >= 0
        })
        // Slice from that index (or return empty if no match)
        entries = idx >= 0 ? entries.slice(idx) : []
        break
      }
      case 'endAt': {
        // Support both RTDB format (_value) and Firestore format (_values)
        const value = (constraint as any)._value ?? (constraint as any)._values?.[0]
        // Find first entry where ordered value > endAt value (exclusive)
        const idx = entries.findIndex((e) => {
          const orderVal = getOrderValue(e, constraints)
          return compareValues(orderVal, value) > 0
        })
        // Slice up to that index (exclusive), or keep all if none exceed
        entries = idx >= 0 ? entries.slice(0, idx) : entries
        break
      }
      case 'equalTo': {
        const value = (constraint as any)._value
        entries = entries.filter((e) => getOrderValue(e, constraints) === value)
        break
      }
    }
  }

  // Reconstruct snapshot
  const newValue: Record<string, unknown> = {}
  for (const entry of entries) {
    newValue[entry.key] = entry.value
  }

  const db = (snapshot.ref?.database as DatabaseImpl)?._storage
  return new DataSnapshotImpl(
    db,
    snapshot.ref?.path ?? '/',
    snapshot.key,
    newValue
  )
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = path.split('/')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function getOrderValue(
  entry: { key: string; value: unknown; priority: string | number | null },
  constraints: DBQueryConstraint[]
): unknown {
  for (const c of constraints) {
    if (c.type === 'orderByChild') {
      return getNestedValue(entry.value, (c as any)._path)
    }
    if (c.type === 'orderByKey') {
      return entry.key
    }
    if (c.type === 'orderByValue') {
      return entry.value
    }
    if (c.type === 'orderByPriority') {
      return entry.priority
    }
  }
  return entry.key
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return String(a).localeCompare(String(b))
}

// ============================================================================
// DATABASE TRANSACTIONS
// ============================================================================

/**
 * Run a database transaction
 */
export async function runDbTransaction(
  reference: DatabaseReference,
  transactionUpdate: (currentData: unknown) => unknown,
  _options?: { applyLocally?: boolean }
): Promise<TransactionResult> {
  const storage = (reference.database as DatabaseImpl)._storage
  const currentValue = storage.get(reference.path)

  const newValue = transactionUpdate(currentValue)

  if (newValue === undefined) {
    // Transaction aborted
    return {
      committed: false,
      snapshot: storage.createSnapshot(reference.path),
    }
  }

  storage.set(reference.path, newValue)

  return {
    committed: true,
    snapshot: storage.createSnapshot(reference.path),
  }
}

// ============================================================================
// DATABASE ONLINE/OFFLINE
// ============================================================================

/**
 * Go offline
 */
export function goOffline(database: Database): void {
  const storage = (database as DatabaseImpl)._storage
  storage.goOffline()
}

/**
 * Go online
 */
export function goOnline(database: Database): void {
  const storage = (database as DatabaseImpl)._storage
  storage.goOnline()
}

