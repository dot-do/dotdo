/**
 * Firestore module for @chdb/firebase-compat
 *
 * Provides Firebase Firestore-compatible APIs backed by ClickHouse/chdb.
 */

import type {
  Firestore,
  CollectionReference as FirebaseCollectionReference,
  DocumentReference as FirebaseDocumentReference,
  DocumentSnapshot as FirebaseDocumentSnapshot,
  QueryDocumentSnapshot as FirebaseQueryDocumentSnapshot,
  QuerySnapshot as FirebaseQuerySnapshot,
  Query as FirebaseQuery,
  QueryConstraint as FirebaseQueryConstraint,
  DocumentData,
  SetOptions,
  UpdateData,
  WithFieldValue,
  PartialWithFieldValue,
  WhereFilterOp,
  OrderByDirection,
} from 'firebase/firestore';

// Re-export types that users might need
export type {
  Firestore,
  DocumentData,
  SetOptions,
  WhereFilterOp,
  OrderByDirection,
};

// Internal storage for documents per Firestore instance (key: app.name, value: collection -> doc -> data)
const documentStores = new Map<string, Map<string, Map<string, DocumentData>>>();

/**
 * Gets or creates the document store for a Firestore instance
 */
function getDocumentStore(firestore: Firestore): Map<string, Map<string, DocumentData>> {
  const key = firestore.app.name;
  if (!documentStores.has(key)) {
    documentStores.set(key, new Map());
  }
  return documentStores.get(key)!;
}

/**
 * Gets or creates a collection in the document store
 */
function getCollection(firestore: Firestore, collectionPath: string): Map<string, DocumentData> {
  const store = getDocumentStore(firestore);
  if (!store.has(collectionPath)) {
    store.set(collectionPath, new Map());
  }
  return store.get(collectionPath)!;
}

/**
 * Generates a random document ID (Firebase-style)
 */
function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Query constraint types
 */
type ConstraintType = 'where' | 'orderBy' | 'limit' | 'limitToLast' | 'startAt' | 'startAfter' | 'endAt' | 'endBefore';

interface WhereConstraint {
  type: 'where';
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

interface OrderByConstraint {
  type: 'orderBy';
  field: string;
  direction: OrderByDirection;
}

interface LimitConstraint {
  type: 'limit';
  value: number;
}

interface LimitToLastConstraint {
  type: 'limitToLast';
  value: number;
}

interface CursorConstraint {
  type: 'startAt' | 'startAfter' | 'endAt' | 'endBefore';
  values: unknown[];
  snapshot?: DocumentSnapshotImpl<DocumentData>;
}

type Constraint = WhereConstraint | OrderByConstraint | LimitConstraint | LimitToLastConstraint | CursorConstraint;

/**
 * QueryConstraint implementation
 */
class QueryConstraintImpl {
  readonly type: ConstraintType;
  readonly _constraint: Constraint;

  constructor(constraint: Constraint) {
    this.type = constraint.type as ConstraintType;
    this._constraint = constraint;
  }
}

/**
 * CollectionReference implementation
 */
class CollectionReferenceImpl<T extends DocumentData = DocumentData> {
  readonly type = 'collection' as const;
  readonly id: string;
  readonly path: string;
  readonly firestore: Firestore;
  readonly parent: DocumentReferenceImpl<DocumentData> | null;
  readonly converter = null;

  constructor(firestore: Firestore, path: string, parent: DocumentReferenceImpl<DocumentData> | null = null) {
    this.firestore = firestore;
    this.path = path;
    this.parent = parent;

    const segments = path.split('/');
    this.id = segments[segments.length - 1];
  }

  doc(documentPath?: string): DocumentReferenceImpl<T> {
    const docId = documentPath ?? generateId();
    const fullPath = `${this.path}/${docId}`;
    return new DocumentReferenceImpl<T>(this.firestore, fullPath, this as unknown as CollectionReferenceImpl<DocumentData>);
  }

  withConverter<U extends DocumentData>(_converter: unknown): CollectionReferenceImpl<U> {
    return this as unknown as CollectionReferenceImpl<U>;
  }
}

/**
 * DocumentReference implementation
 */
class DocumentReferenceImpl<T extends DocumentData = DocumentData> {
  readonly type = 'document' as const;
  readonly id: string;
  readonly path: string;
  readonly firestore: Firestore;
  readonly parent: CollectionReferenceImpl<DocumentData>;
  readonly converter = null;

  constructor(firestore: Firestore, path: string, parent?: CollectionReferenceImpl<DocumentData>) {
    this.firestore = firestore;
    this.path = path;

    const segments = path.split('/');
    this.id = segments[segments.length - 1];

    if (parent) {
      this.parent = parent;
    } else {
      const parentPath = segments.slice(0, -1).join('/');
      this.parent = new CollectionReferenceImpl<DocumentData>(firestore, parentPath);
    }
  }

  collection(collectionPath: string): CollectionReferenceImpl<DocumentData> {
    const fullPath = `${this.path}/${collectionPath}`;
    return new CollectionReferenceImpl<DocumentData>(this.firestore, fullPath, this as DocumentReferenceImpl<DocumentData>);
  }

  withConverter<U extends DocumentData>(_converter: unknown): DocumentReferenceImpl<U> {
    return this as unknown as DocumentReferenceImpl<U>;
  }
}

/**
 * DocumentSnapshot implementation
 */
class DocumentSnapshotImpl<T extends DocumentData = DocumentData> {
  readonly id: string;
  readonly ref: DocumentReferenceImpl<T>;
  readonly metadata = { hasPendingWrites: false, fromCache: false, isEqual: () => false };
  protected _data: T | undefined;

  constructor(ref: DocumentReferenceImpl<T>, data: T | undefined) {
    this.id = ref.id;
    this.ref = ref;
    this._data = data;
  }

  exists(): boolean {
    return this._data !== undefined;
  }

  data(): T | undefined {
    return this._data;
  }

  get(fieldPath: string): unknown {
    if (!this._data) return undefined;

    const parts = fieldPath.split('.');
    let value: unknown = this._data;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }
}

/**
 * QueryDocumentSnapshot implementation (always exists)
 */
class QueryDocumentSnapshotImpl<T extends DocumentData = DocumentData> extends DocumentSnapshotImpl<T> {
  constructor(ref: DocumentReferenceImpl<T>, data: T) {
    super(ref, data);
  }

  override exists(): boolean {
    return true;
  }

  override data(): T {
    return this._data!;
  }
}

/**
 * QuerySnapshot implementation
 */
class QuerySnapshotImpl<T extends DocumentData = DocumentData> {
  readonly docs: QueryDocumentSnapshotImpl<T>[];
  readonly query: QueryImpl<T>;
  readonly metadata = { hasPendingWrites: false, fromCache: false, isEqual: () => false };

  constructor(query: QueryImpl<T>, docs: QueryDocumentSnapshotImpl<T>[]) {
    this.query = query;
    this.docs = docs;
  }

  get size(): number {
    return this.docs.length;
  }

  get empty(): boolean {
    return this.docs.length === 0;
  }

  forEach(callback: (result: QueryDocumentSnapshotImpl<T>) => void): void {
    this.docs.forEach(callback);
  }

  docChanges(): unknown[] {
    return [];
  }
}

/**
 * Query implementation
 */
class QueryImpl<T extends DocumentData = DocumentData> {
  readonly type = 'query' as const;
  readonly firestore: Firestore;
  readonly converter = null;

  readonly _collectionPath: string;
  readonly _constraints: Constraint[];

  constructor(firestore: Firestore, collectionPath: string, constraints: Constraint[] = []) {
    this.firestore = firestore;
    this._collectionPath = collectionPath;
    this._constraints = constraints;
  }

  withConverter<U extends DocumentData>(_converter: unknown): QueryImpl<U> {
    return this as unknown as QueryImpl<U>;
  }
}

/**
 * Creates a CollectionGroupQuery that queries all collections with the same ID.
 */
class CollectionGroupQueryImpl<T extends DocumentData = DocumentData> extends QueryImpl<T> {
  readonly _isCollectionGroup = true;
  readonly _collectionId: string;

  constructor(firestore: Firestore, collectionId: string, constraints: Constraint[] = []) {
    super(firestore, collectionId, constraints);
    this._collectionId = collectionId;
  }
}

// Export types as aliases
export type CollectionReference<T extends DocumentData = DocumentData> = FirebaseCollectionReference<T, T>;
export type DocumentReference<T extends DocumentData = DocumentData> = FirebaseDocumentReference<T, T>;
export type DocumentSnapshot<T extends DocumentData = DocumentData> = FirebaseDocumentSnapshot<T, T>;
export type QueryDocumentSnapshot<T extends DocumentData = DocumentData> = FirebaseQueryDocumentSnapshot<T, T>;
export type QuerySnapshot<T extends DocumentData = DocumentData> = FirebaseQuerySnapshot<T, T>;
export type Query<T extends DocumentData = DocumentData> = FirebaseQuery<T, T>;
export type QueryConstraint = FirebaseQueryConstraint;

/**
 * Gets a CollectionReference for the specified path.
 */
export function collection(
  firestore: Firestore,
  path: string,
  ...pathSegments: string[]
): CollectionReference;
export function collection(
  reference: DocumentReference,
  path: string,
  ...pathSegments: string[]
): CollectionReference;
export function collection(
  firestoreOrRef: Firestore | DocumentReference,
  path: string,
  ...pathSegments: string[]
): CollectionReference {
  const fullPath = [path, ...pathSegments].join('/');

  if ('type' in firestoreOrRef && firestoreOrRef.type === 'document') {
    const docRef = firestoreOrRef as unknown as DocumentReferenceImpl<DocumentData>;
    const combinedPath = `${docRef.path}/${fullPath}`;
    return new CollectionReferenceImpl(docRef.firestore, combinedPath, docRef) as unknown as CollectionReference;
  }

  const firestore = firestoreOrRef as Firestore;
  return new CollectionReferenceImpl(firestore, fullPath) as unknown as CollectionReference;
}

/**
 * Gets a DocumentReference for the specified path.
 */
export function doc(
  firestore: Firestore,
  path: string,
  ...pathSegments: string[]
): DocumentReference;
export function doc(
  reference: CollectionReference,
  path?: string,
  ...pathSegments: string[]
): DocumentReference;
export function doc(
  firestoreOrRef: Firestore | CollectionReference,
  path?: string,
  ...pathSegments: string[]
): DocumentReference {
  if ('type' in firestoreOrRef && firestoreOrRef.type === 'collection') {
    const colRef = firestoreOrRef as unknown as CollectionReferenceImpl<DocumentData>;
    const docId = path ?? generateId();
    const segments = [docId, ...pathSegments];
    const fullPath = `${colRef.path}/${segments.join('/')}`;
    return new DocumentReferenceImpl(colRef.firestore, fullPath, colRef) as unknown as DocumentReference;
  }

  const firestore = firestoreOrRef as Firestore;
  const fullPath = [path!, ...pathSegments].join('/');
  return new DocumentReferenceImpl(firestore, fullPath) as unknown as DocumentReference;
}

/**
 * Adds a new document to the collection with an auto-generated ID.
 */
export async function addDoc<T extends DocumentData>(
  reference: CollectionReference<T>,
  data: WithFieldValue<T>
): Promise<DocumentReference<T>> {
  const colRef = reference as unknown as CollectionReferenceImpl<T>;
  const docRef = colRef.doc();

  const collectionData = getCollection(colRef.firestore, colRef.path);
  const processedData = processDataForWrite(data as DocumentData);
  collectionData.set(docRef.id, structuredClone(processedData));

  // Notify listeners
  notifyDocumentListeners(colRef.firestore, colRef.path, docRef.id);
  notifyQueryListeners(colRef.firestore, colRef.path);

  return docRef as unknown as DocumentReference<T>;
}

/**
 * Writes to a document. If the document does not exist, it will be created.
 */
export async function setDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: WithFieldValue<T>
): Promise<void>;
export async function setDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: PartialWithFieldValue<T>,
  options: SetOptions
): Promise<void>;
export async function setDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: WithFieldValue<T> | PartialWithFieldValue<T>,
  options?: SetOptions
): Promise<void> {
  const docRef = reference as unknown as DocumentReferenceImpl<T>;
  const collectionPath = docRef.parent.path;
  const collectionData = getCollection(docRef.firestore, collectionPath);

  const opts = options as { merge?: boolean; mergeFields?: string[] } | undefined;

  // Process field values (like serverTimestamp) - inline to avoid forward reference
  const processedData = processDataForWrite(data as DocumentData);

  if (opts?.merge) {
    const existing = collectionData.get(docRef.id) || {};
    collectionData.set(docRef.id, { ...existing, ...structuredClone(processedData) });
  } else if (opts?.mergeFields) {
    const existing = collectionData.get(docRef.id) || {};
    const newData = structuredClone(processedData);
    const merged = { ...existing };

    for (const field of opts.mergeFields) {
      if (field in newData) {
        (merged as Record<string, unknown>)[field] = (newData as Record<string, unknown>)[field];
      }
    }

    collectionData.set(docRef.id, merged);
  } else {
    collectionData.set(docRef.id, structuredClone(processedData));
  }

  // Notify listeners
  notifyDocumentListeners(docRef.firestore, collectionPath, docRef.id);
  notifyQueryListeners(docRef.firestore, collectionPath);
}

/**
 * Helper to process data for write operations, handling FieldValue sentinels.
 * Defined early to be available to setDoc and addDoc.
 */
function processDataForWrite(data: DocumentData): DocumentData {
  const result: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '_isServerTimestamp' in value && typeof (value as { _isServerTimestamp: () => boolean })._isServerTimestamp === 'function' && (value as { _isServerTimestamp: () => boolean })._isServerTimestamp()) {
      // Server timestamp sentinel - replace with current timestamp
      // Store as internal representation that will be converted to Timestamp on read
      const now = new Date();
      const millis = now.getTime();
      const seconds = Math.floor(millis / 1000);
      const nanoseconds = (millis % 1000) * 1000000;
      result[key] = { __firestoreType: 'Timestamp', seconds, nanoseconds };
    } else if (value && typeof value === 'object' && '_seconds' in value && '_nanoseconds' in value) {
      // Already a Timestamp-like object - store as internal representation
      result[key] = { __firestoreType: 'Timestamp', seconds: (value as { _seconds: number })._seconds, nanoseconds: (value as { _nanoseconds: number })._nanoseconds };
    } else if (value && typeof value === 'object' && '_latitude' in value && '_longitude' in value) {
      // Already a GeoPoint-like object - store as internal representation
      result[key] = { __firestoreType: 'GeoPoint', latitude: (value as { _latitude: number })._latitude, longitude: (value as { _longitude: number })._longitude };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = processDataForWrite(value as DocumentData);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Reference to the restore function, set after Timestamp/GeoPoint are defined.
 */
let _restoreFirestoreTypes: ((data: DocumentData) => DocumentData) | null = null;

/**
 * Helper to restore Firestore types when reading data.
 * Uses a late-bound function reference to handle forward declaration.
 */
function restoreFirestoreTypes(data: DocumentData): DocumentData {
  if (_restoreFirestoreTypes) {
    return _restoreFirestoreTypes(data);
  }
  return data;
}

/**
 * Reads a document from the database.
 */
export async function getDoc<T extends DocumentData>(
  reference: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  const docRef = reference as unknown as DocumentReferenceImpl<T>;
  const collectionPath = docRef.parent.path;
  const collectionData = getCollection(docRef.firestore, collectionPath);

  const data = collectionData.get(docRef.id);
  const restoredData = data ? restoreFirestoreTypes(structuredClone(data)) as T : undefined;
  return new DocumentSnapshotImpl(docRef, restoredData) as unknown as DocumentSnapshot<T>;
}

/**
 * Reads all documents from a collection or query.
 */
export async function getDocs<T extends DocumentData>(
  queryOrCollection: Query<T> | CollectionReference<T>
): Promise<QuerySnapshot<T>> {
  let firestore: Firestore;
  let collectionPath: string;
  let constraints: Constraint[] = [];
  let isCollectionGroup = false;
  let collectionId = '';

  const maybeQuery = queryOrCollection as unknown as QueryImpl<T> & { _isCollectionGroup?: boolean; _collectionId?: string };
  if (maybeQuery._collectionPath !== undefined) {
    firestore = maybeQuery.firestore;
    collectionPath = maybeQuery._collectionPath;
    constraints = maybeQuery._constraints;
    isCollectionGroup = maybeQuery._isCollectionGroup === true;
    collectionId = maybeQuery._collectionId || '';
  } else {
    const colRef = queryOrCollection as unknown as CollectionReferenceImpl<T>;
    firestore = colRef.firestore;
    collectionPath = colRef.path;
  }

  // Validate constraints - check for multiple range inequality filters on different fields (without orderBy)
  // Firebase allows != with other operators if proper orderBy is present
  const whereConstraints = constraints.filter((c): c is WhereConstraint => c.type === 'where');
  const orderByConstraintsForValidation = constraints.filter((c): c is OrderByConstraint => c.type === 'orderBy');
  const rangeOps: WhereFilterOp[] = ['<', '<=', '>', '>='];
  const rangeFields = new Set<string>();
  for (const w of whereConstraints) {
    if (rangeOps.includes(w.op)) {
      rangeFields.add(w.field);
    }
  }
  // Only throw if we have range inequalities on multiple fields AND no orderBy to allow it
  if (rangeFields.size > 1 && orderByConstraintsForValidation.length === 0) {
    throw new Error(`Invalid compound query: inequality filters on different fields (${Array.from(rangeFields).join(', ')}) require a composite index`);
  }

  let entries: Array<[string, DocumentData, string]> = []; // [id, data, fullPath]

  if (isCollectionGroup) {
    // Collect documents from all collections with matching ID
    const store = getDocumentStore(firestore);
    for (const [path, collectionMap] of store.entries()) {
      const segments = path.split('/');
      const lastSegment = segments[segments.length - 1];
      if (lastSegment === collectionId) {
        for (const [docId, data] of collectionMap.entries()) {
          entries.push([docId, data, `${path}/${docId}`]);
        }
      }
    }
  } else {
    const collectionData = getCollection(firestore, collectionPath);
    entries = Array.from(collectionData.entries()).map(([id, data]) => [id, data, `${collectionPath}/${id}`]);
  }

  // Apply where constraints
  for (const w of whereConstraints) {
    entries = entries.filter(([, data]) => {
      const fieldValue = getFieldValue(data, w.field);
      return applyWhereOp(fieldValue, w.op, w.value);
    });
  }

  // Apply orderBy constraints
  const orderByConstraints = constraints.filter((c): c is OrderByConstraint => c.type === 'orderBy');
  if (orderByConstraints.length > 0) {
    entries.sort((a, b) => {
      for (const ob of orderByConstraints) {
        const aVal = getFieldValue(a[1], ob.field);
        const bVal = getFieldValue(b[1], ob.field);
        const cmp = compareValues(aVal, bVal);
        if (cmp !== 0) {
          return ob.direction === 'desc' ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  // Apply cursor constraints
  const startAtConstraint = constraints.find((c): c is CursorConstraint => c.type === 'startAt');
  const startAfterConstraint = constraints.find((c): c is CursorConstraint => c.type === 'startAfter');
  const endAtConstraint = constraints.find((c): c is CursorConstraint => c.type === 'endAt');
  const endBeforeConstraint = constraints.find((c): c is CursorConstraint => c.type === 'endBefore');

  if (startAtConstraint || startAfterConstraint) {
    const constraint = startAtConstraint || startAfterConstraint;
    const inclusive = !!startAtConstraint;

    if (constraint?.snapshot) {
      const snapshotId = constraint.snapshot.id;
      const idx = entries.findIndex(([id]) => id === snapshotId);
      if (idx !== -1) {
        entries = entries.slice(inclusive ? idx : idx + 1);
      }
    } else if (constraint && orderByConstraints.length > 0) {
      const cursorValue = constraint.values[0];
      const orderByField = orderByConstraints[0].field;
      const idx = entries.findIndex(([, data]) => {
        const val = getFieldValue(data, orderByField);
        const cmp = compareValues(val, cursorValue);
        return inclusive ? cmp >= 0 : cmp > 0;
      });
      if (idx !== -1) {
        entries = entries.slice(idx);
      } else {
        entries = [];
      }
    }
  }

  if (endAtConstraint || endBeforeConstraint) {
    const constraint = endAtConstraint || endBeforeConstraint;
    const inclusive = !!endAtConstraint;

    if (constraint?.snapshot) {
      const snapshotId = constraint.snapshot.id;
      const idx = entries.findIndex(([id]) => id === snapshotId);
      if (idx !== -1) {
        entries = entries.slice(0, inclusive ? idx + 1 : idx);
      }
    } else if (constraint && orderByConstraints.length > 0) {
      const cursorValue = constraint.values[0];
      const orderByField = orderByConstraints[0].field;
      const idx = entries.findIndex(([, data]) => {
        const val = getFieldValue(data, orderByField);
        const cmp = compareValues(val, cursorValue);
        return inclusive ? cmp > 0 : cmp >= 0;
      });
      if (idx !== -1) {
        entries = entries.slice(0, idx);
      }
    }
  }

  // Apply limit constraints
  const limitConstraint = constraints.find((c): c is LimitConstraint => c.type === 'limit');
  const limitToLastConstraint = constraints.find((c): c is LimitToLastConstraint => c.type === 'limitToLast');

  if (limitToLastConstraint) {
    entries = entries.slice(-limitToLastConstraint.value);
  } else if (limitConstraint) {
    entries = entries.slice(0, limitConstraint.value);
  }

  // Create snapshots
  const docs = entries.map(([id, data, fullPath]) => {
    const docRef = new DocumentReferenceImpl<T>(firestore, fullPath);
    const restoredData = restoreFirestoreTypes(structuredClone(data)) as T;
    return new QueryDocumentSnapshotImpl<T>(docRef, restoredData);
  });

  const q = new QueryImpl<T>(firestore, collectionPath, constraints);
  return new QuerySnapshotImpl<T>(q, docs) as unknown as QuerySnapshot<T>;
}

/**
 * Helper to get nested field value
 */
function getFieldValue(data: DocumentData, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let value: unknown = data;

  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Helper to set nested field value
 */
function setFieldValue(data: DocumentData, fieldPath: string, value: unknown): void {
  const parts = fieldPath.split('.');
  let current: Record<string, unknown> = data;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Helper to compare values for sorting
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }

  return String(a).localeCompare(String(b));
}

/**
 * Gets a comparable numeric value from a field value (handles Timestamps)
 */
function getComparableValue(value: unknown): number | string | unknown {
  if (value && typeof value === 'object') {
    // Check for internal Timestamp format
    if ('__firestoreType' in value && (value as { __firestoreType: string }).__firestoreType === 'Timestamp') {
      const ts = value as unknown as { seconds: number; nanoseconds: number };
      return ts.seconds * 1000 + ts.nanoseconds / 1000000;
    }
    // Check for Timestamp instance (from query value)
    if ('_seconds' in value && '_nanoseconds' in value) {
      const ts = value as { _seconds: number; _nanoseconds: number };
      return ts._seconds * 1000 + ts._nanoseconds / 1000000;
    }
    // Check for toMillis method (Timestamp class)
    if ('toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis();
    }
  }
  return value;
}

/**
 * Helper to apply where operator
 */
function applyWhereOp(fieldValue: unknown, op: WhereFilterOp, compareValue: unknown): boolean {
  // Get comparable values (handles Timestamps)
  const comparableFieldValue = getComparableValue(fieldValue);
  const comparableCompareValue = getComparableValue(compareValue);

  switch (op) {
    case '==':
      return comparableFieldValue === comparableCompareValue;
    case '!=':
      return comparableFieldValue !== comparableCompareValue;
    case '<':
      return (comparableFieldValue as number) < (comparableCompareValue as number);
    case '<=':
      return (comparableFieldValue as number) <= (comparableCompareValue as number);
    case '>':
      return (comparableFieldValue as number) > (comparableCompareValue as number);
    case '>=':
      return (comparableFieldValue as number) >= (comparableCompareValue as number);
    case 'array-contains':
      return Array.isArray(fieldValue) && fieldValue.includes(compareValue);
    case 'array-contains-any':
      return Array.isArray(fieldValue) &&
             Array.isArray(compareValue) &&
             compareValue.some(v => fieldValue.includes(v));
    case 'in':
      return Array.isArray(compareValue) && compareValue.includes(comparableFieldValue);
    case 'not-in':
      return Array.isArray(compareValue) && !compareValue.includes(comparableFieldValue);
    default:
      return false;
  }
}

/**
 * Updates fields in a document.
 */
export async function updateDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  data: UpdateData<T>
): Promise<void>;
export async function updateDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  field: string,
  value: unknown,
  ...moreFieldsAndValues: unknown[]
): Promise<void>;
export async function updateDoc<T extends DocumentData>(
  reference: DocumentReference<T>,
  dataOrField: UpdateData<T> | string,
  value?: unknown,
  ...moreFieldsAndValues: unknown[]
): Promise<void> {
  const docRef = reference as unknown as DocumentReferenceImpl<T>;
  const collectionPath = docRef.parent.path;
  const collectionData = getCollection(docRef.firestore, collectionPath);

  const existing = collectionData.get(docRef.id);
  if (!existing) {
    throw new Error(`Document ${docRef.path} does not exist`);
  }

  const updated = structuredClone(existing);

  if (typeof dataOrField === 'string') {
    setFieldValue(updated, dataOrField, value);
    for (let i = 0; i < moreFieldsAndValues.length; i += 2) {
      setFieldValue(updated, moreFieldsAndValues[i] as string, moreFieldsAndValues[i + 1]);
    }
  } else {
    const data = dataOrField as Record<string, unknown>;
    for (const [key, val] of Object.entries(data)) {
      setFieldValue(updated, key, val);
    }
  }

  collectionData.set(docRef.id, updated);

  // Notify listeners
  notifyDocumentListeners(docRef.firestore, collectionPath, docRef.id);
  notifyQueryListeners(docRef.firestore, collectionPath);
}

/**
 * Deletes a document from the database.
 */
export async function deleteDoc(reference: DocumentReference): Promise<void> {
  const docRef = reference as unknown as DocumentReferenceImpl<DocumentData>;
  const collectionPath = docRef.parent.path;
  const collectionData = getCollection(docRef.firestore, collectionPath);
  collectionData.delete(docRef.id);

  // Notify listeners
  notifyDocumentListeners(docRef.firestore, collectionPath, docRef.id);
  notifyQueryListeners(docRef.firestore, collectionPath);
}

/**
 * Creates a new query from a collection reference with optional constraints.
 */
export function query<T extends DocumentData>(
  queryOrCollection: Query<T> | CollectionReference<T>,
  ...queryConstraints: QueryConstraint[]
): Query<T> {
  let firestore: Firestore;
  let collectionPath: string;
  let existingConstraints: Constraint[] = [];
  let isCollectionGroup = false;
  let collectionId = '';

  const maybeQuery = queryOrCollection as unknown as QueryImpl<T> & { _isCollectionGroup?: boolean; _collectionId?: string };
  if (maybeQuery._collectionPath !== undefined) {
    firestore = maybeQuery.firestore;
    collectionPath = maybeQuery._collectionPath;
    existingConstraints = maybeQuery._constraints;
    isCollectionGroup = maybeQuery._isCollectionGroup === true;
    collectionId = maybeQuery._collectionId || '';
  } else {
    const colRef = queryOrCollection as unknown as CollectionReferenceImpl<T>;
    firestore = colRef.firestore;
    collectionPath = colRef.path;
  }

  const newConstraints = queryConstraints.map(c => (c as QueryConstraintImpl)._constraint);
  const combinedConstraints = [...existingConstraints, ...newConstraints];

  // Preserve collection group query type
  if (isCollectionGroup) {
    return new CollectionGroupQueryImpl<T>(firestore, collectionId, combinedConstraints) as unknown as Query<T>;
  }

  return new QueryImpl<T>(firestore, collectionPath, combinedConstraints) as unknown as Query<T>;
}

/**
 * Creates a QueryConstraint for filtering documents.
 */
export function where(
  fieldPath: string,
  opStr: WhereFilterOp,
  value: unknown
): QueryConstraint {
  return new QueryConstraintImpl({
    type: 'where',
    field: fieldPath,
    op: opStr,
    value,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint for ordering documents.
 */
export function orderBy(
  fieldPath: string,
  directionStr: OrderByDirection = 'asc'
): QueryConstraint {
  return new QueryConstraintImpl({
    type: 'orderBy',
    field: fieldPath,
    direction: directionStr,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to limit the number of documents.
 */
export function limit(limitValue: number): QueryConstraint {
  return new QueryConstraintImpl({
    type: 'limit',
    value: limitValue,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to return the last N documents.
 */
export function limitToLast(limitValue: number): QueryConstraint {
  return new QueryConstraintImpl({
    type: 'limitToLast',
    value: limitValue,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to start results at a specific value.
 */
export function startAt(...fieldValues: unknown[]): QueryConstraint;
export function startAt(snapshot: DocumentSnapshot<DocumentData>): QueryConstraint;
export function startAt(...args: unknown[]): QueryConstraint {
  const firstArg = args[0];

  if (firstArg && typeof firstArg === 'object' && 'ref' in (firstArg as object)) {
    return new QueryConstraintImpl({
      type: 'startAt',
      values: [],
      snapshot: firstArg as DocumentSnapshotImpl<DocumentData>,
    }) as unknown as QueryConstraint;
  }

  return new QueryConstraintImpl({
    type: 'startAt',
    values: args,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to start results after a specific value.
 */
export function startAfter(...fieldValues: unknown[]): QueryConstraint;
export function startAfter(snapshot: DocumentSnapshot<DocumentData>): QueryConstraint;
export function startAfter(...args: unknown[]): QueryConstraint {
  const firstArg = args[0];

  if (firstArg && typeof firstArg === 'object' && 'ref' in (firstArg as object)) {
    return new QueryConstraintImpl({
      type: 'startAfter',
      values: [],
      snapshot: firstArg as DocumentSnapshotImpl<DocumentData>,
    }) as unknown as QueryConstraint;
  }

  return new QueryConstraintImpl({
    type: 'startAfter',
    values: args,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to end results at a specific value.
 */
export function endAt(...fieldValues: unknown[]): QueryConstraint;
export function endAt(snapshot: DocumentSnapshot<DocumentData>): QueryConstraint;
export function endAt(...args: unknown[]): QueryConstraint {
  const firstArg = args[0];

  if (firstArg && typeof firstArg === 'object' && 'ref' in (firstArg as object)) {
    return new QueryConstraintImpl({
      type: 'endAt',
      values: [],
      snapshot: firstArg as DocumentSnapshotImpl<DocumentData>,
    }) as unknown as QueryConstraint;
  }

  return new QueryConstraintImpl({
    type: 'endAt',
    values: args,
  }) as unknown as QueryConstraint;
}

/**
 * Creates a QueryConstraint to end results before a specific value.
 */
export function endBefore(...fieldValues: unknown[]): QueryConstraint;
export function endBefore(snapshot: DocumentSnapshot<DocumentData>): QueryConstraint;
export function endBefore(...args: unknown[]): QueryConstraint {
  const firstArg = args[0];

  if (firstArg && typeof firstArg === 'object' && 'ref' in (firstArg as object)) {
    return new QueryConstraintImpl({
      type: 'endBefore',
      values: [],
      snapshot: firstArg as DocumentSnapshotImpl<DocumentData>,
    }) as unknown as QueryConstraint;
  }

  return new QueryConstraintImpl({
    type: 'endBefore',
    values: args,
  }) as unknown as QueryConstraint;
}

// =============================================================================
// Advanced Features: Timestamp, GeoPoint, serverTimestamp
// =============================================================================

/**
 * A Timestamp represents a point in time independent of any time zone or calendar.
 */
export class Timestamp {
  private readonly _seconds: number;
  private readonly _nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this._seconds = seconds;
    this._nanoseconds = nanoseconds;
  }

  /**
   * Creates a Timestamp from a JavaScript Date object.
   */
  static fromDate(date: Date): Timestamp {
    const millis = date.getTime();
    const seconds = Math.floor(millis / 1000);
    const nanoseconds = (millis % 1000) * 1000000;
    return new Timestamp(seconds, nanoseconds);
  }

  /**
   * Creates a Timestamp for the current time.
   */
  static now(): Timestamp {
    return Timestamp.fromDate(new Date());
  }

  /**
   * Converts a Timestamp to a JavaScript Date object.
   */
  toDate(): Date {
    return new Date(this._seconds * 1000 + this._nanoseconds / 1000000);
  }

  /**
   * Returns the timestamp in milliseconds.
   */
  toMillis(): number {
    return this._seconds * 1000 + this._nanoseconds / 1000000;
  }

  get seconds(): number {
    return this._seconds;
  }

  get nanoseconds(): number {
    return this._nanoseconds;
  }

  /**
   * Returns true if this Timestamp is equal to the provided one.
   */
  isEqual(other: Timestamp): boolean {
    return this._seconds === other._seconds && this._nanoseconds === other._nanoseconds;
  }

  /**
   * Converts Timestamp to a JSON-serializable object.
   */
  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this._seconds, nanoseconds: this._nanoseconds };
  }

  valueOf(): number {
    return this.toMillis();
  }
}

/**
 * An immutable object representing a geographic location in Firestore.
 */
export class GeoPoint {
  private readonly _latitude: number;
  private readonly _longitude: number;

  constructor(latitude: number, longitude: number) {
    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be in the range [-90, 90]');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be in the range [-180, 180]');
    }
    this._latitude = latitude;
    this._longitude = longitude;
  }

  get latitude(): number {
    return this._latitude;
  }

  get longitude(): number {
    return this._longitude;
  }

  /**
   * Returns true if this GeoPoint is equal to the provided one.
   */
  isEqual(other: GeoPoint): boolean {
    return this._latitude === other._latitude && this._longitude === other._longitude;
  }

  /**
   * Converts GeoPoint to a JSON-serializable object.
   */
  toJSON(): { latitude: number; longitude: number } {
    return { latitude: this._latitude, longitude: this._longitude };
  }
}

/**
 * Sentinel value to use with setDoc or updateDoc to indicate server timestamp.
 */
const SERVER_TIMESTAMP_SENTINEL = Symbol('serverTimestamp');

/**
 * FieldValue class for special field operations.
 */
export class FieldValue {
  private readonly _type: symbol;

  private constructor(type: symbol) {
    this._type = type;
  }

  static _serverTimestamp(): FieldValue {
    return new FieldValue(SERVER_TIMESTAMP_SENTINEL);
  }

  _isServerTimestamp(): boolean {
    return this._type === SERVER_TIMESTAMP_SENTINEL;
  }
}

/**
 * Returns a sentinel value that tells the server to use the current time
 * as the timestamp value for a field.
 */
export function serverTimestamp(): FieldValue {
  return FieldValue._serverTimestamp();
}

/**
 * Restores Firestore types from internal storage representation.
 * This is the actual implementation used when reading data.
 */
function restoreFirestoreTypesImpl(data: DocumentData): DocumentData {
  const result: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__firestoreType' in value) {
      const typed = value as { __firestoreType: string; [key: string]: unknown };
      if (typed.__firestoreType === 'Timestamp') {
        result[key] = new Timestamp(typed.seconds as number, typed.nanoseconds as number);
      } else if (typed.__firestoreType === 'GeoPoint') {
        result[key] = new GeoPoint(typed.latitude as number, typed.longitude as number);
      } else {
        result[key] = value;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = restoreFirestoreTypesImpl(value as DocumentData);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Set the late-bound function reference
_restoreFirestoreTypes = restoreFirestoreTypesImpl;

/**
 * Processes data to replace FieldValue sentinels with actual values.
 */
function processFieldValues(data: DocumentData): DocumentData {
  const result: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue && value._isServerTimestamp()) {
      result[key] = Timestamp.now();
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Timestamp) && !(value instanceof GeoPoint)) {
      result[key] = processFieldValues(value as DocumentData);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// =============================================================================
// Collection Group Queries
// =============================================================================

/**
 * Creates a query that queries all collections and subcollections with the same collection ID.
 */
export function collectionGroup(firestore: Firestore, collectionId: string): Query {
  if (!collectionId || collectionId.trim() === '') {
    throw new Error('Invalid collection ID: collection ID cannot be empty');
  }
  return new CollectionGroupQueryImpl(firestore, collectionId) as unknown as Query;
}

/**
 * Gets all collection paths that end with the given collection ID.
 * @internal - kept for reference but not used currently
 */
function getAllCollectionPathsWithId(firestore: Firestore, collectionId: string): string[] {
  const store = getDocumentStore(firestore);
  const matchingPaths: string[] = [];

  for (const path of store.keys()) {
    const segments = path.split('/');
    const lastSegment = segments[segments.length - 1];
    if (lastSegment === collectionId) {
      matchingPaths.push(path);
    }
  }

  return matchingPaths;
}

// =============================================================================
// Batch Writes
// =============================================================================

interface BatchOperation {
  type: 'set' | 'update' | 'delete';
  docRef: DocumentReferenceImpl<DocumentData>;
  data?: DocumentData;
  options?: SetOptions;
}

/**
 * WriteBatch implementation for atomic batch operations.
 */
class WriteBatchImpl {
  private readonly _firestore: Firestore;
  private readonly _operations: BatchOperation[] = [];
  private _committed = false;

  constructor(firestore: Firestore) {
    this._firestore = firestore;
  }

  /**
   * Writes to a document in the batch.
   */
  set<T extends DocumentData>(
    docRef: DocumentReference<T>,
    data: WithFieldValue<T>,
    options?: SetOptions
  ): WriteBatchImpl {
    if (this._committed) {
      throw new Error('Batch has already been committed');
    }
    this._operations.push({
      type: 'set',
      docRef: docRef as unknown as DocumentReferenceImpl<DocumentData>,
      data: processFieldValues(data as DocumentData),
      options,
    });
    return this;
  }

  /**
   * Updates fields in a document in the batch.
   */
  update<T extends DocumentData>(
    docRef: DocumentReference<T>,
    data: UpdateData<T>
  ): WriteBatchImpl {
    if (this._committed) {
      throw new Error('Batch has already been committed');
    }
    this._operations.push({
      type: 'update',
      docRef: docRef as unknown as DocumentReferenceImpl<DocumentData>,
      data: processFieldValues(data as DocumentData),
    });
    return this;
  }

  /**
   * Deletes a document in the batch.
   */
  delete(docRef: DocumentReference): WriteBatchImpl {
    if (this._committed) {
      throw new Error('Batch has already been committed');
    }
    this._operations.push({
      type: 'delete',
      docRef: docRef as unknown as DocumentReferenceImpl<DocumentData>,
    });
    return this;
  }

  /**
   * Commits all operations in the batch atomically.
   */
  async commit(): Promise<void> {
    if (this._committed) {
      throw new Error('Batch has already been committed');
    }

    // Validate all operations first (fail atomically)
    for (const op of this._operations) {
      if (op.type === 'update') {
        const collectionPath = op.docRef.parent.path;
        const collectionData = getCollection(this._firestore, collectionPath);
        if (!collectionData.has(op.docRef.id)) {
          throw new Error(`Document ${op.docRef.path} does not exist`);
        }
      }
    }

    // Execute all operations
    for (const op of this._operations) {
      const collectionPath = op.docRef.parent.path;
      const collectionData = getCollection(this._firestore, collectionPath);

      switch (op.type) {
        case 'set': {
          const opts = op.options as { merge?: boolean; mergeFields?: string[] } | undefined;
          if (opts?.merge) {
            const existing = collectionData.get(op.docRef.id) || {};
            collectionData.set(op.docRef.id, { ...existing, ...structuredClone(op.data!) });
          } else if (opts?.mergeFields) {
            const existing = collectionData.get(op.docRef.id) || {};
            const newData = structuredClone(op.data!);
            const merged = { ...existing };
            for (const field of opts.mergeFields) {
              if (field in newData) {
                (merged as Record<string, unknown>)[field] = (newData as Record<string, unknown>)[field];
              }
            }
            collectionData.set(op.docRef.id, merged);
          } else {
            collectionData.set(op.docRef.id, structuredClone(op.data!));
          }
          break;
        }
        case 'update': {
          const existing = collectionData.get(op.docRef.id)!;
          const updated = structuredClone(existing);
          for (const [key, val] of Object.entries(op.data!)) {
            setFieldValue(updated, key, val);
          }
          collectionData.set(op.docRef.id, updated);
          break;
        }
        case 'delete':
          collectionData.delete(op.docRef.id);
          break;
      }
    }

    this._committed = true;
  }
}

/**
 * Creates a WriteBatch for performing multiple writes atomically.
 */
export function writeBatch(firestore: Firestore): WriteBatchImpl {
  return new WriteBatchImpl(firestore);
}

// =============================================================================
// Transactions
// =============================================================================

/**
 * Transaction implementation for atomic read-write operations.
 */
class TransactionImpl {
  private readonly _firestore: Firestore;
  private readonly _readDocs: Map<string, DocumentData | undefined> = new Map();
  private readonly _writeDocs: Map<string, { type: 'set' | 'update' | 'delete'; data?: DocumentData; options?: SetOptions }> = new Map();
  private _hasWrites = false;

  constructor(firestore: Firestore) {
    this._firestore = firestore;
  }

  /**
   * Reads a document in the transaction.
   */
  async get<T extends DocumentData>(docRef: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    const ref = docRef as unknown as DocumentReferenceImpl<T>;

    // Check if we already have writes - Firebase requires reads before writes
    if (this._hasWrites) {
      throw new Error('Reads must come before writes in a transaction');
    }

    const collectionPath = ref.parent.path;
    const collectionData = getCollection(this._firestore, collectionPath);
    const data = collectionData.get(ref.id);

    this._readDocs.set(ref.path, data);

    return new DocumentSnapshotImpl(ref, data ? structuredClone(data) as T : undefined) as unknown as DocumentSnapshot<T>;
  }

  /**
   * Writes to a document in the transaction.
   */
  set<T extends DocumentData>(
    docRef: DocumentReference<T>,
    data: WithFieldValue<T>,
    options?: SetOptions
  ): TransactionImpl {
    const ref = docRef as unknown as DocumentReferenceImpl<T>;
    this._hasWrites = true;
    this._writeDocs.set(ref.path, {
      type: 'set',
      data: processFieldValues(data as DocumentData),
      options,
    });
    return this;
  }

  /**
   * Updates fields in a document in the transaction.
   */
  update<T extends DocumentData>(
    docRef: DocumentReference<T>,
    data: UpdateData<T>
  ): TransactionImpl {
    const ref = docRef as unknown as DocumentReferenceImpl<T>;
    this._hasWrites = true;
    this._writeDocs.set(ref.path, {
      type: 'update',
      data: processFieldValues(data as DocumentData),
    });
    return this;
  }

  /**
   * Deletes a document in the transaction.
   */
  delete(docRef: DocumentReference): TransactionImpl {
    const ref = docRef as unknown as DocumentReferenceImpl<DocumentData>;
    this._hasWrites = true;
    this._writeDocs.set(ref.path, { type: 'delete' });
    return this;
  }

  /**
   * Commits all writes in the transaction.
   * @internal
   */
  async _commit(): Promise<void> {
    for (const [path, write] of this._writeDocs) {
      const segments = path.split('/');
      const docId = segments.pop()!;
      const collectionPath = segments.join('/');
      const collectionData = getCollection(this._firestore, collectionPath);

      switch (write.type) {
        case 'set': {
          const opts = write.options as { merge?: boolean; mergeFields?: string[] } | undefined;
          if (opts?.merge) {
            const existing = collectionData.get(docId) || {};
            collectionData.set(docId, { ...existing, ...structuredClone(write.data!) });
          } else {
            collectionData.set(docId, structuredClone(write.data!));
          }
          break;
        }
        case 'update': {
          const existing = collectionData.get(docId);
          if (!existing) {
            throw new Error(`Document ${path} does not exist`);
          }
          const updated = structuredClone(existing);
          for (const [key, val] of Object.entries(write.data!)) {
            setFieldValue(updated, key, val);
          }
          collectionData.set(docId, updated);
          break;
        }
        case 'delete':
          collectionData.delete(docId);
          break;
      }
    }
  }
}

/**
 * Runs a transaction with the provided update function.
 */
export async function runTransaction<T>(
  firestore: Firestore,
  updateFunction: (transaction: TransactionImpl) => Promise<T>
): Promise<T> {
  const transaction = new TransactionImpl(firestore);

  try {
    const result = await updateFunction(transaction);
    await transaction._commit();
    return result;
  } catch (error) {
    // Transaction failed, no commit happens (rollback)
    throw error;
  }
}

// =============================================================================
// Aggregate Queries
// =============================================================================

/**
 * Represents an aggregate field specification.
 */
export class AggregateField<T = unknown> {
  readonly _aggregateType: 'count' | 'sum' | 'average';
  readonly _fieldPath?: string;

  constructor(type: 'count' | 'sum' | 'average', fieldPath?: string) {
    this._aggregateType = type;
    this._fieldPath = fieldPath;
  }
}

/**
 * Creates an AggregateField for counting documents.
 */
export function count(): AggregateField<number> {
  return new AggregateField('count');
}

/**
 * Creates an AggregateField for summing a numeric field.
 */
export function sum(fieldPath: string): AggregateField<number> {
  return new AggregateField('sum', fieldPath);
}

/**
 * Creates an AggregateField for averaging a numeric field.
 */
export function average(fieldPath: string): AggregateField<number | null> {
  return new AggregateField('average', fieldPath);
}

/**
 * AggregateSpec type for aggregate queries.
 */
export type AggregateSpec = Record<string, AggregateField>;

/**
 * AggregateQuerySnapshot containing aggregate results.
 */
class AggregateQuerySnapshotImpl<T extends AggregateSpec> {
  private readonly _data: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    this._data = data;
  }

  data(): { [K in keyof T]: T[K] extends AggregateField<infer U> ? U : never } {
    return this._data as { [K in keyof T]: T[K] extends AggregateField<infer U> ? U : never };
  }
}

/**
 * Gets the count of documents from the server.
 */
export async function getCountFromServer<T extends DocumentData>(
  queryOrCollection: Query<T> | CollectionReference<T>
): Promise<AggregateQuerySnapshotImpl<{ count: AggregateField<number> }>> {
  const snapshot = await getDocs(queryOrCollection);
  return new AggregateQuerySnapshotImpl({ count: snapshot.size });
}

/**
 * Gets aggregate values from the server.
 */
export async function getAggregateFromServer<T extends DocumentData, AggregateSpecType extends AggregateSpec>(
  queryOrCollection: Query<T> | CollectionReference<T>,
  aggregateSpec: AggregateSpecType
): Promise<AggregateQuerySnapshotImpl<AggregateSpecType>> {
  const snapshot = await getDocs(queryOrCollection);
  const docs = snapshot.docs;
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(aggregateSpec)) {
    switch (field._aggregateType) {
      case 'count':
        result[key] = docs.length;
        break;
      case 'sum': {
        let total = 0;
        for (const doc of docs) {
          const value = getFieldValue(doc.data(), field._fieldPath!);
          if (typeof value === 'number') {
            total += value;
          }
        }
        result[key] = total;
        break;
      }
      case 'average': {
        if (docs.length === 0) {
          result[key] = null;
        } else {
          let total = 0;
          let count = 0;
          for (const doc of docs) {
            const value = getFieldValue(doc.data(), field._fieldPath!);
            if (typeof value === 'number') {
              total += value;
              count++;
            }
          }
          result[key] = count > 0 ? total / count : null;
        }
        break;
      }
    }
  }

  return new AggregateQuerySnapshotImpl(result);
}

// =============================================================================
// Realtime Listeners (onSnapshot)
// =============================================================================

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

/**
 * Snapshot listen options
 */
export interface SnapshotListenOptions {
  includeMetadataChanges?: boolean;
}

/**
 * Document change type
 */
export interface DocumentChange<T extends DocumentData = DocumentData> {
  type: 'added' | 'modified' | 'removed';
  doc: QueryDocumentSnapshotImpl<T>;
  oldIndex: number;
  newIndex: number;
}

/**
 * Observer object form for onSnapshot
 */
interface SnapshotObserver<T> {
  next?: (snapshot: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

/**
 * Listener entry for document listeners
 */
interface DocumentListener<T extends DocumentData = DocumentData> {
  docRef: DocumentReferenceImpl<T>;
  callback: (snapshot: DocumentSnapshotImpl<T>) => void;
  errorCallback?: (error: Error) => void;
}

/**
 * Listener entry for query/collection listeners
 */
interface QueryListener<T extends DocumentData = DocumentData> {
  query: QueryImpl<T> | CollectionReferenceImpl<T>;
  callback: (snapshot: QuerySnapshotImplWithChanges<T>) => void;
  errorCallback?: (error: Error) => void;
  lastDocs: Map<string, T>; // Track previous state for docChanges
}

/**
 * Internal listener registry per Firestore instance
 */
const documentListeners = new Map<string, Set<DocumentListener<DocumentData>>>();
const queryListeners = new Map<string, Set<QueryListener<DocumentData>>>();

/**
 * Gets or creates the document listener set for a Firestore instance
 */
function getDocumentListeners(firestore: Firestore): Set<DocumentListener<DocumentData>> {
  const key = firestore.app.name;
  if (!documentListeners.has(key)) {
    documentListeners.set(key, new Set());
  }
  return documentListeners.get(key)!;
}

/**
 * Gets or creates the query listener set for a Firestore instance
 */
function getQueryListeners(firestore: Firestore): Set<QueryListener<DocumentData>> {
  const key = firestore.app.name;
  if (!queryListeners.has(key)) {
    queryListeners.set(key, new Set());
  }
  return queryListeners.get(key)!;
}

/**
 * Extended QuerySnapshot that tracks document changes
 */
class QuerySnapshotImplWithChanges<T extends DocumentData = DocumentData> extends QuerySnapshotImpl<T> {
  private _changes: DocumentChange<T>[];

  constructor(query: QueryImpl<T>, docs: QueryDocumentSnapshotImpl<T>[], changes: DocumentChange<T>[]) {
    super(query, docs);
    this._changes = changes;
  }

  override docChanges(): DocumentChange<T>[] {
    return this._changes;
  }
}

/**
 * Computes document changes between old and new document sets
 */
function computeDocChanges<T extends DocumentData>(
  oldDocs: Map<string, T>,
  newDocs: QueryDocumentSnapshotImpl<T>[]
): DocumentChange<T>[] {
  const changes: DocumentChange<T>[] = [];
  const newDocsMap = new Map<string, QueryDocumentSnapshotImpl<T>>();

  // Build map of new docs
  newDocs.forEach((doc, index) => {
    newDocsMap.set(doc.id, doc);
  });

  // Find removed docs
  for (const [id] of oldDocs) {
    if (!newDocsMap.has(id)) {
      // Doc was removed - create a dummy snapshot for removed doc
      const oldData = oldDocs.get(id)!;
      // We need to create a proper reference for the removed doc
      // For now, use the first new doc's firestore reference as basis
      if (newDocs.length > 0) {
        const firestore = newDocs[0].ref.firestore;
        const collectionPath = newDocs[0].ref.parent.path;
        const docRef = new DocumentReferenceImpl<T>(firestore, `${collectionPath}/${id}`);
        changes.push({
          type: 'removed',
          doc: new QueryDocumentSnapshotImpl<T>(docRef, oldData),
          oldIndex: Array.from(oldDocs.keys()).indexOf(id),
          newIndex: -1,
        });
      }
    }
  }

  // Find added and modified docs
  newDocs.forEach((doc, newIndex) => {
    const oldData = oldDocs.get(doc.id);
    if (oldData === undefined) {
      changes.push({
        type: 'added',
        doc,
        oldIndex: -1,
        newIndex,
      });
    } else {
      // Check if modified (simple JSON comparison)
      if (JSON.stringify(oldData) !== JSON.stringify(doc.data())) {
        changes.push({
          type: 'modified',
          doc,
          oldIndex: Array.from(oldDocs.keys()).indexOf(doc.id),
          newIndex,
        });
      }
    }
  });

  return changes;
}

/**
 * Notifies all document listeners that might be affected by a change
 */
function notifyDocumentListeners(firestore: Firestore, collectionPath: string, docId: string): void {
  const listeners = getDocumentListeners(firestore);
  const fullPath = `${collectionPath}/${docId}`;

  for (const listener of listeners) {
    if (listener.docRef.path === fullPath) {
      // Re-read the document and notify
      const collectionData = getCollection(firestore, collectionPath);
      const data = collectionData.get(docId);
      const restoredData = data ? restoreFirestoreTypes(structuredClone(data)) : undefined;
      const snapshot = new DocumentSnapshotImpl(listener.docRef, restoredData);
      try {
        listener.callback(snapshot as DocumentSnapshotImpl<DocumentData>);
      } catch (err) {
        if (listener.errorCallback) {
          listener.errorCallback(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }
}

/**
 * Notifies all query listeners that might be affected by a change in a collection
 */
function notifyQueryListeners(firestore: Firestore, collectionPath: string): void {
  const listeners = getQueryListeners(firestore);

  for (const listener of listeners) {
    const listenerCollectionPath = listener.query instanceof CollectionReferenceImpl
      ? listener.query.path
      : listener.query._collectionPath;

    // Check if this listener cares about this collection
    if (listenerCollectionPath === collectionPath) {
      // Re-execute the query and notify
      executeQueryForListener(firestore, listener);
    }
  }
}

/**
 * Executes query for a listener and notifies with changes
 */
async function executeQueryForListener<T extends DocumentData>(
  firestore: Firestore,
  listener: QueryListener<T>
): Promise<void> {
  try {
    let collectionPath: string;
    let constraints: Constraint[] = [];

    if (listener.query instanceof CollectionReferenceImpl) {
      collectionPath = listener.query.path;
    } else {
      collectionPath = listener.query._collectionPath;
      constraints = listener.query._constraints;
    }

    const collectionData = getCollection(firestore, collectionPath);
    let entries = Array.from(collectionData.entries()).map(([id, data]) => [id, data, `${collectionPath}/${id}`] as [string, DocumentData, string]);

    // Apply where constraints
    const whereConstraints = constraints.filter((c): c is WhereConstraint => c.type === 'where');
    for (const w of whereConstraints) {
      entries = entries.filter(([, data]) => {
        const fieldValue = getFieldValue(data, w.field);
        return applyWhereOp(fieldValue, w.op, w.value);
      });
    }

    // Apply orderBy constraints
    const orderByConstraints = constraints.filter((c): c is OrderByConstraint => c.type === 'orderBy');
    if (orderByConstraints.length > 0) {
      entries.sort((a, b) => {
        for (const ob of orderByConstraints) {
          const aVal = getFieldValue(a[1], ob.field);
          const bVal = getFieldValue(b[1], ob.field);
          const cmp = compareValues(aVal, bVal);
          if (cmp !== 0) {
            return ob.direction === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // Apply limit constraints
    const limitConstraint = constraints.find((c): c is LimitConstraint => c.type === 'limit');
    const limitToLastConstraint = constraints.find((c): c is LimitToLastConstraint => c.type === 'limitToLast');

    if (limitToLastConstraint) {
      entries = entries.slice(-limitToLastConstraint.value);
    } else if (limitConstraint) {
      entries = entries.slice(0, limitConstraint.value);
    }

    // Create snapshots
    const docs = entries.map(([id, data, fullPath]) => {
      const docRef = new DocumentReferenceImpl<T>(firestore, fullPath);
      const restoredData = restoreFirestoreTypes(structuredClone(data)) as T;
      return new QueryDocumentSnapshotImpl<T>(docRef, restoredData);
    });

    // Compute changes
    const changes = computeDocChanges(listener.lastDocs, docs);

    // Update lastDocs
    listener.lastDocs.clear();
    for (const doc of docs) {
      listener.lastDocs.set(doc.id, doc.data());
    }

    // Create query for snapshot
    const q = listener.query instanceof CollectionReferenceImpl
      ? new QueryImpl<T>(firestore, collectionPath, [])
      : listener.query;

    const snapshot = new QuerySnapshotImplWithChanges<T>(q as QueryImpl<T>, docs, changes);
    (listener.callback as (snapshot: QuerySnapshotImplWithChanges<T>) => void)(snapshot);
  } catch (err) {
    if (listener.errorCallback) {
      listener.errorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * Attaches a listener for document snapshot events.
 */
export function onSnapshot<T extends DocumentData>(
  reference: DocumentReference<T>,
  observer: SnapshotObserver<DocumentSnapshot<T>>
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  reference: DocumentReference<T>,
  onNext: (snapshot: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  reference: DocumentReference<T>,
  options: SnapshotListenOptions,
  observer: SnapshotObserver<DocumentSnapshot<T>>
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  reference: DocumentReference<T>,
  options: SnapshotListenOptions,
  onNext: (snapshot: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  query: Query<T>,
  observer: SnapshotObserver<QuerySnapshot<T>>
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  query: Query<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  query: Query<T>,
  options: SnapshotListenOptions,
  observer: SnapshotObserver<QuerySnapshot<T>>
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  query: Query<T>,
  options: SnapshotListenOptions,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  reference: CollectionReference<T>,
  observer: SnapshotObserver<QuerySnapshot<T>>
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  reference: CollectionReference<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
  onCompletion?: () => void
): Unsubscribe;
export function onSnapshot<T extends DocumentData>(
  refOrQuery: DocumentReference<T> | Query<T> | CollectionReference<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  observerOrOptionsOrOnNext?: SnapshotObserver<any> | SnapshotListenOptions | ((snapshot: any) => void),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onNextOrOnErrorOrObserver?: ((snapshot: any) => void) | ((error: Error) => void) | SnapshotObserver<any>,
  onErrorOrCompletion?: ((error: Error) => void) | (() => void),
  onCompletion?: () => void
): Unsubscribe {
  // Parse arguments
  let onNext: ((snapshot: unknown) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;

  if (typeof observerOrOptionsOrOnNext === 'function') {
    onNext = observerOrOptionsOrOnNext;
    onError = onNextOrOnErrorOrObserver as ((error: Error) => void) | undefined;
  } else if (observerOrOptionsOrOnNext && typeof observerOrOptionsOrOnNext === 'object') {
    if ('next' in observerOrOptionsOrOnNext) {
      // Observer object
      onNext = observerOrOptionsOrOnNext.next;
      onError = observerOrOptionsOrOnNext.error;
    } else {
      // Options object, next arg is the callback
      if (typeof onNextOrOnErrorOrObserver === 'function') {
        onNext = onNextOrOnErrorOrObserver as (snapshot: unknown) => void;
        onError = onErrorOrCompletion as ((error: Error) => void) | undefined;
      } else if (onNextOrOnErrorOrObserver && typeof onNextOrOnErrorOrObserver === 'object' && 'next' in onNextOrOnErrorOrObserver) {
        onNext = onNextOrOnErrorOrObserver.next;
        onError = onNextOrOnErrorOrObserver.error;
      }
    }
  }

  if (!onNext) {
    throw new Error('onSnapshot requires a callback function');
  }

  // Determine if this is a document or query/collection listener
  const ref = refOrQuery as unknown as { type?: string };

  if (ref.type === 'document') {
    // Document listener
    const docRef = refOrQuery as unknown as DocumentReferenceImpl<T>;
    const listeners = getDocumentListeners(docRef.firestore);

    const listener: DocumentListener<T> = {
      docRef,
      callback: onNext as (snapshot: DocumentSnapshotImpl<T>) => void,
      errorCallback: onError,
    };

    listeners.add(listener as DocumentListener<DocumentData>);

    // Fire initial snapshot immediately (async to match Firebase behavior)
    queueMicrotask(() => {
      const collectionPath = docRef.parent.path;
      const collectionData = getCollection(docRef.firestore, collectionPath);
      const data = collectionData.get(docRef.id);
      const restoredData = data ? restoreFirestoreTypes(structuredClone(data)) as T : undefined;
      const snapshot = new DocumentSnapshotImpl(docRef, restoredData);
      try {
        onNext!(snapshot as unknown);
      } catch (err) {
        if (onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    // Return unsubscribe function
    return () => {
      listeners.delete(listener as DocumentListener<DocumentData>);
    };
  } else {
    // Query or Collection listener
    const queryOrCol = refOrQuery as unknown as QueryImpl<T> | CollectionReferenceImpl<T>;
    const firestore = queryOrCol.firestore;
    const listeners = getQueryListeners(firestore);

    const listener: QueryListener<T> = {
      query: queryOrCol,
      callback: onNext as (snapshot: QuerySnapshotImplWithChanges<T>) => void,
      errorCallback: onError,
      lastDocs: new Map(),
    };

    listeners.add(listener as unknown as QueryListener<DocumentData>);

    // Fire initial snapshot immediately (async to match Firebase behavior)
    queueMicrotask(() => {
      executeQueryForListener(firestore, listener);
    });

    // Return unsubscribe function
    return () => {
      listeners.delete(listener as unknown as QueryListener<DocumentData>);
    };
  }
}
