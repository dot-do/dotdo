/**
 * @dotdo/firebase
 *
 * Firebase Firestore and Realtime Database compatible SDK
 * backed by Durable Object SQLite storage.
 *
 * @example
 * ```typescript
 * import { initializeApp } from '@dotdo/firebase'
 * import { getFirestore, collection, addDoc } from '@dotdo/firebase/firestore'
 * import { getDatabase, ref, set } from '@dotdo/firebase/database'
 *
 * const app = initializeApp({ projectId: 'my-project' })
 *
 * // Firestore
 * const db = getFirestore(app)
 * await addDoc(collection(db, 'users'), { name: 'Alice' })
 *
 * // Realtime Database
 * const rtdb = getDatabase(app)
 * await set(ref(rtdb, 'messages/1'), { text: 'Hello' })
 * ```
 */

// Re-export types (excluding classes that are re-exported from firebase.ts)
export type {
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
  FieldValue,
  AggregateSpec,
  AggregateField,
  AggregateQuerySnapshot,
  Unsubscribe,
  DatabaseReference,
  DataSnapshot,
  ThenableReference,
  DatabaseQueryConstraint,
  TransactionResult,
  EventType,
} from './types'

// Re-export implementation (includes classes: Bytes, FieldPath, GeoPoint, Timestamp)
export * from './firebase'
