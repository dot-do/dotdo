/**
 * @dotdo/firebase - Firebase SDK compat tests
 *
 * Tests for Firebase Firestore and Realtime Database API compatibility
 * backed by DO SQLite:
 *
 * Firestore:
 * - initializeApp, getFirestore
 * - collection, doc
 * - addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc
 * - query, where, orderBy, limit, startAfter, endBefore
 * - onSnapshot for real-time updates
 * - writeBatch, runTransaction
 * - Aggregation: count, sum, average
 *
 * Realtime Database:
 * - getDatabase
 * - ref, child, push
 * - set, get, update, remove
 * - onValue, onChildAdded, onChildChanged, onChildRemoved
 * - query constraints: orderByChild, limitToFirst, etc.
 *
 * @see https://firebase.google.com/docs/firestore/reference/js
 * @see https://firebase.google.com/docs/database/web/read-and-write
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  DocumentData,
  SetOptions,
  WriteBatch,
  Transaction,
  DatabaseReference,
  DataSnapshot,
  Timestamp,
  GeoPoint,
  FieldPath,
  FieldValue,
} from './types'
import { FirestoreError } from './types'
import {
  // App
  initializeApp,
  deleteApp,
  getApp,
  getApps,
  // Firestore
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  startAt,
  startAfter,
  endAt,
  endBefore,
  onSnapshot,
  writeBatch,
  runTransaction,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  clearIndexedDbPersistence,
  terminate,
  waitForPendingWrites,
  // Field values
  serverTimestamp,
  deleteField,
  increment,
  arrayUnion,
  arrayRemove,
  documentId,
  // Helpers
  Timestamp as TimestampClass,
  GeoPoint as GeoPointClass,
  FieldPath as FieldPathClass,
  Bytes,
  // Aggregation
  getCountFromServer,
  getAggregateFromServer,
  count,
  sum,
  average,
  // Realtime Database
  getDatabase,
  ref,
  child,
  push,
  set,
  get,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onChildMoved,
  off,
  orderByChild,
  orderByKey,
  orderByValue,
  orderByPriority,
  limitToFirst,
  limitToLast as rtdbLimitToLast,
  startAt as rtdbStartAt,
  startAfter as rtdbStartAfter,
  endAt as rtdbEndAt,
  endBefore as rtdbEndBefore,
  equalTo,
  dbQuery,
  runDbTransaction,
  setPriority,
  setWithPriority,
  // Converters
  refFromURL,
  goOnline,
  goOffline,
} from './firebase'

// ============================================================================
// APP INITIALIZATION TESTS
// ============================================================================

describe('Firebase App', () => {
  afterEach(() => {
    // Clean up apps between tests
    const apps = getApps()
    apps.forEach((app) => deleteApp(app))
  })

  it('should initialize app with minimal config', () => {
    const app = initializeApp({ projectId: 'test-project' })
    expect(app).toBeDefined()
    expect(app.options.projectId).toBe('test-project')
  })

  it('should initialize app with full config', () => {
    const config: FirebaseConfig = {
      apiKey: 'test-api-key',
      authDomain: 'test-project.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test-project.appspot.com',
      messagingSenderId: '123456789',
      appId: '1:123456789:web:abcdef',
      databaseURL: 'https://test-project.firebaseio.com',
    }
    const app = initializeApp(config)
    expect(app.options).toEqual(config)
  })

  it('should initialize app with custom name', () => {
    const app = initializeApp({ projectId: 'test-project' }, 'custom-app')
    expect(app.name).toBe('custom-app')
  })

  it('should use default name [DEFAULT]', () => {
    const app = initializeApp({ projectId: 'test-project' })
    expect(app.name).toBe('[DEFAULT]')
  })

  it('should get default app', () => {
    const app = initializeApp({ projectId: 'test-project' })
    const retrieved = getApp()
    expect(retrieved).toBe(app)
  })

  it('should get named app', () => {
    const app = initializeApp({ projectId: 'test-project' }, 'named')
    const retrieved = getApp('named')
    expect(retrieved).toBe(app)
  })

  it('should throw when getting non-existent app', () => {
    expect(() => getApp('nonexistent')).toThrow()
  })

  it('should list all apps', () => {
    initializeApp({ projectId: 'project1' }, 'app1')
    initializeApp({ projectId: 'project2' }, 'app2')
    const apps = getApps()
    expect(apps.length).toBe(2)
  })

  it('should delete app', async () => {
    const app = initializeApp({ projectId: 'test-project' })
    await deleteApp(app)
    expect(() => getApp()).toThrow()
  })

  it('should accept extended DO config', () => {
    const config: ExtendedFirebaseConfig = {
      projectId: 'test-project',
      doNamespace: {} as DurableObjectNamespace,
      shard: { algorithm: 'consistent', count: 4 },
      replica: { readPreference: 'nearest' },
    }
    const app = initializeApp(config)
    expect(app).toBeDefined()
  })
})

// ============================================================================
// FIRESTORE INSTANCE TESTS
// ============================================================================

describe('Firestore Instance', () => {
  let app: FirebaseApp

  beforeEach(() => {
    app = initializeApp({ projectId: 'test-project' })
  })

  afterEach(() => {
    deleteApp(app)
  })

  it('should get Firestore instance', () => {
    const db = getFirestore(app)
    expect(db).toBeDefined()
    expect(db.type).toBe('firestore')
  })

  it('should get Firestore from default app', () => {
    const db = getFirestore()
    expect(db.app).toBe(app)
  })

  it('should return same instance for same app', () => {
    const db1 = getFirestore(app)
    const db2 = getFirestore(app)
    expect(db1).toBe(db2)
  })

  it('should convert to JSON', () => {
    const db = getFirestore(app)
    const json = db.toJSON()
    expect(json).toBeDefined()
  })
})

// ============================================================================
// COLLECTION & DOCUMENT REFERENCE TESTS
// ============================================================================

describe('Collection Reference', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should create collection reference', () => {
    const col = collection(db, 'users')
    expect(col).toBeDefined()
    expect(col.id).toBe('users')
    expect(col.path).toBe('users')
    expect(col.type).toBe('collection')
  })

  it('should create nested collection reference', () => {
    const col = collection(db, 'users/alice/posts')
    expect(col.id).toBe('posts')
    expect(col.path).toBe('users/alice/posts')
  })

  it('should have null parent for root collection', () => {
    const col = collection(db, 'users')
    expect(col.parent).toBe(null)
  })

  it('should have document parent for subcollection', () => {
    const col = collection(db, 'users/alice/posts')
    expect(col.parent).toBeDefined()
    expect(col.parent?.id).toBe('alice')
  })

  it('should get document from collection', () => {
    const col = collection(db, 'users')
    const docRef = col.doc('alice')
    expect(docRef.id).toBe('alice')
    expect(docRef.path).toBe('users/alice')
  })

  it('should generate document ID when not provided', () => {
    const col = collection(db, 'users')
    const docRef = col.doc()
    expect(docRef.id).toBeDefined()
    expect(docRef.id.length).toBeGreaterThan(0)
  })
})

describe('Document Reference', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should create document reference', () => {
    const docRef = doc(db, 'users/alice')
    expect(docRef).toBeDefined()
    expect(docRef.id).toBe('alice')
    expect(docRef.path).toBe('users/alice')
    expect(docRef.type).toBe('document')
  })

  it('should get parent collection', () => {
    const docRef = doc(db, 'users/alice')
    expect(docRef.parent.id).toBe('users')
  })

  it('should get subcollection from document', () => {
    const docRef = doc(db, 'users/alice')
    const subCol = docRef.collection('posts')
    expect(subCol.path).toBe('users/alice/posts')
  })

  it('should convert to string', () => {
    const docRef = doc(db, 'users/alice')
    expect(docRef.toString()).toBe('users/alice')
  })

  it('should check equality', () => {
    const ref1 = doc(db, 'users/alice')
    const ref2 = doc(db, 'users/alice')
    const ref3 = doc(db, 'users/bob')
    expect(ref1.isEqual(ref2)).toBe(true)
    expect(ref1.isEqual(ref3)).toBe(false)
  })

  it('should support data converter', () => {
    interface User {
      name: string
      age: number
    }

    const converter = {
      toFirestore: (user: User) => ({ name: user.name, age: user.age }),
      fromFirestore: (snapshot: QueryDocumentSnapshot<DocumentData>) => {
        const data = snapshot.data()
        return { name: data.name as string, age: data.age as number }
      },
    }

    const docRef = doc(db, 'users/alice').withConverter(converter)
    expect(docRef).toBeDefined()
  })

  it('should remove converter with null', () => {
    interface User {
      name: string
    }

    const converter = {
      toFirestore: (user: User) => user,
      fromFirestore: (snapshot: QueryDocumentSnapshot<DocumentData>) => snapshot.data() as User,
    }

    const typedRef = doc(db, 'users/alice').withConverter(converter)
    const untypedRef = typedRef.withConverter(null)
    expect(untypedRef).toBeDefined()
  })
})

// ============================================================================
// CRUD OPERATIONS TESTS
// ============================================================================

describe('addDoc', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should add document with auto ID', async () => {
    const col = collection(db, 'users')
    const docRef = await addDoc(col, { name: 'Alice', age: 30 })
    expect(docRef.id).toBeDefined()
    expect(docRef.id.length).toBeGreaterThan(0)
  })

  it('should return document reference', async () => {
    const col = collection(db, 'users')
    const docRef = await addDoc(col, { name: 'Bob' })
    expect(docRef.parent.id).toBe('users')
  })
})

describe('setDoc', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should set document data', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', age: 30 })

    const snapshot = await getDoc(docRef)
    expect(snapshot.exists).toBe(true)
    expect(snapshot.data()?.name).toBe('Alice')
  })

  it('should overwrite existing document', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', age: 30 })
    await setDoc(docRef, { name: 'Alicia' })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.name).toBe('Alicia')
    expect(snapshot.data()?.age).toBeUndefined()
  })

  it('should merge with existing document', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', age: 30 })
    await setDoc(docRef, { email: 'alice@example.com.ai' }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.name).toBe('Alice')
    expect(snapshot.data()?.email).toBe('alice@example.com.ai')
  })

  it('should merge only specified fields', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', age: 30, city: 'NYC' })
    await setDoc(docRef, { name: 'Alicia', age: 31, city: 'LA' }, { mergeFields: ['name'] })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.name).toBe('Alicia')
    expect(snapshot.data()?.age).toBe(30)
    expect(snapshot.data()?.city).toBe('NYC')
  })
})

describe('getDoc', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should get existing document', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice' })

    const snapshot = await getDoc(docRef)
    expect(snapshot.exists).toBe(true)
    expect(snapshot.id).toBe('alice')
    expect(snapshot.ref).toBe(docRef)
  })

  it('should return non-existing document', async () => {
    const docRef = doc(db, 'users/nonexistent')
    const snapshot = await getDoc(docRef)
    expect(snapshot.exists).toBe(false)
    expect(snapshot.data()).toBeUndefined()
  })

  it('should get specific field', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', nested: { value: 42 } })

    const snapshot = await getDoc(docRef)
    expect(snapshot.get('name')).toBe('Alice')
    expect(snapshot.get('nested.value')).toBe(42)
  })

  it('should include metadata', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice' })

    const snapshot = await getDoc(docRef)
    expect(snapshot.metadata).toBeDefined()
    expect(typeof snapshot.metadata.fromCache).toBe('boolean')
    expect(typeof snapshot.metadata.hasPendingWrites).toBe('boolean')
  })
})

describe('getDocs', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)

    // Seed data
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', age: 30 })
    await setDoc(doc(db, 'users/bob'), { name: 'Bob', age: 25 })
    await setDoc(doc(db, 'users/charlie'), { name: 'Charlie', age: 35 })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should get all documents in collection', async () => {
    const col = collection(db, 'users')
    const snapshot = await getDocs(col)
    expect(snapshot.size).toBe(3)
    expect(snapshot.empty).toBe(false)
  })

  it('should iterate with forEach', async () => {
    const col = collection(db, 'users')
    const snapshot = await getDocs(col)

    const names: string[] = []
    snapshot.forEach((doc) => {
      names.push(doc.data().name as string)
    })
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
    expect(names).toContain('Charlie')
  })

  it('should access docs array', async () => {
    const col = collection(db, 'users')
    const snapshot = await getDocs(col)
    expect(snapshot.docs.length).toBe(3)
    expect(snapshot.docs[0].exists).toBe(true)
  })

  it('should include metadata', async () => {
    const col = collection(db, 'users')
    const snapshot = await getDocs(col)
    expect(snapshot.metadata).toBeDefined()
  })
})

describe('updateDoc', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', age: 30, city: 'NYC' })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should update specific fields', async () => {
    const docRef = doc(db, 'users/alice')
    await updateDoc(docRef, { age: 31 })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.age).toBe(31)
    expect(snapshot.data()?.name).toBe('Alice')
  })

  it('should update nested fields', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', address: { city: 'NYC', zip: '10001' } })
    await updateDoc(docRef, { 'address.city': 'LA' })

    const snapshot = await getDoc(docRef)
    expect(snapshot.get('address.city')).toBe('LA')
    expect(snapshot.get('address.zip')).toBe('10001')
  })

  it('should throw on non-existent document', async () => {
    const docRef = doc(db, 'users/nonexistent')
    await expect(updateDoc(docRef, { name: 'Test' })).rejects.toThrow(FirestoreError)
  })
})

describe('deleteDoc', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
    await setDoc(doc(db, 'users/alice'), { name: 'Alice' })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should delete document', async () => {
    const docRef = doc(db, 'users/alice')
    await deleteDoc(docRef)

    const snapshot = await getDoc(docRef)
    expect(snapshot.exists).toBe(false)
  })

  it('should not throw on non-existent document', async () => {
    const docRef = doc(db, 'users/nonexistent')
    await expect(deleteDoc(docRef)).resolves.not.toThrow()
  })
})

// ============================================================================
// QUERY TESTS
// ============================================================================

describe('Query', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)

    // Seed data
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', age: 30, city: 'NYC' })
    await setDoc(doc(db, 'users/bob'), { name: 'Bob', age: 25, city: 'LA' })
    await setDoc(doc(db, 'users/charlie'), { name: 'Charlie', age: 35, city: 'NYC' })
    await setDoc(doc(db, 'users/diana'), { name: 'Diana', age: 28, city: 'SF' })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should create query with where', async () => {
    const q = query(collection(db, 'users'), where('age', '>', 28))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // Alice (30), Charlie (35)
  })

  it('should filter with equality', async () => {
    const q = query(collection(db, 'users'), where('city', '==', 'NYC'))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2)
  })

  it('should filter with not equal', async () => {
    const q = query(collection(db, 'users'), where('city', '!=', 'NYC'))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // Bob (LA), Diana (SF)
  })

  it('should filter with less than or equal', async () => {
    const q = query(collection(db, 'users'), where('age', '<=', 28))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // Bob (25), Diana (28)
  })

  it('should filter with greater than or equal', async () => {
    const q = query(collection(db, 'users'), where('age', '>=', 30))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // Alice (30), Charlie (35)
  })

  it('should filter with in', async () => {
    const q = query(collection(db, 'users'), where('city', 'in', ['NYC', 'LA']))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(3)
  })

  it('should filter with not-in', async () => {
    const q = query(collection(db, 'users'), where('city', 'not-in', ['NYC', 'LA']))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(1) // Diana (SF)
  })

  it('should order by field ascending', async () => {
    const q = query(collection(db, 'users'), orderBy('age'))
    const snapshot = await getDocs(q)
    const ages = snapshot.docs.map((d) => d.data().age as number)
    expect(ages).toEqual([25, 28, 30, 35])
  })

  it('should order by field descending', async () => {
    const q = query(collection(db, 'users'), orderBy('age', 'desc'))
    const snapshot = await getDocs(q)
    const ages = snapshot.docs.map((d) => d.data().age as number)
    expect(ages).toEqual([35, 30, 28, 25])
  })

  it('should limit results', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), limit(2))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2)
  })

  it('should limit to last', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), limitToLast(2))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2)
    expect(snapshot.docs[0].data().age).toBe(30)
  })

  it('should start at value', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), startAt(28))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(3) // 28, 30, 35
  })

  it('should start after value', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), startAfter(28))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // 30, 35
  })

  it('should end at value', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), endAt(30))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(3) // 25, 28, 30
  })

  it('should end before value', async () => {
    const q = query(collection(db, 'users'), orderBy('age'), endBefore(30))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2) // 25, 28
  })

  it('should combine multiple constraints', async () => {
    const q = query(
      collection(db, 'users'),
      where('city', '==', 'NYC'),
      orderBy('age', 'desc'),
      limit(1)
    )
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(1)
    expect(snapshot.docs[0].data().name).toBe('Charlie')
  })

  it('should use cursor with document snapshot', async () => {
    const aliceDoc = await getDoc(doc(db, 'users/alice'))
    const q = query(collection(db, 'users'), orderBy('age'), startAfter(aliceDoc))
    const snapshot = await getDocs(q)
    const ages = snapshot.docs.map((d) => d.data().age as number)
    expect(ages).not.toContain(30)
  })
})

describe('Array Queries', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)

    await setDoc(doc(db, 'posts/1'), { title: 'Post 1', tags: ['tech', 'news'] })
    await setDoc(doc(db, 'posts/2'), { title: 'Post 2', tags: ['sports', 'news'] })
    await setDoc(doc(db, 'posts/3'), { title: 'Post 3', tags: ['tech', 'tutorial'] })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should filter with array-contains', async () => {
    const q = query(collection(db, 'posts'), where('tags', 'array-contains', 'tech'))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2)
  })

  it('should filter with array-contains-any', async () => {
    const q = query(collection(db, 'posts'), where('tags', 'array-contains-any', ['sports', 'tutorial']))
    const snapshot = await getDocs(q)
    expect(snapshot.size).toBe(2)
  })
})

// ============================================================================
// REAL-TIME LISTENER TESTS
// ============================================================================

describe('onSnapshot', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should listen to document changes', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice' })

    const snapshots: DocumentSnapshot[] = []
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      snapshots.push(snapshot)
    })

    // Wait for initial snapshot
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots[0].data()?.name).toBe('Alice')

    unsubscribe()
  })

  it('should listen to collection changes', async () => {
    const col = collection(db, 'messages')

    const snapshots: QuerySnapshot[] = []
    const unsubscribe = onSnapshot(col, (snapshot) => {
      snapshots.push(snapshot)
    })

    // Add a document
    await addDoc(col, { text: 'Hello' })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(snapshots.length).toBeGreaterThan(0)

    unsubscribe()
  })

  it('should listen to query changes', async () => {
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', online: true })
    await setDoc(doc(db, 'users/bob'), { name: 'Bob', online: false })

    const q = query(collection(db, 'users'), where('online', '==', true))

    const snapshots: QuerySnapshot[] = []
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshots.push(snapshot)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(snapshots[0].size).toBe(1)

    unsubscribe()
  })

  it('should handle errors', async () => {
    const docRef = doc(db, 'restricted/doc')

    const errors: Error[] = []
    const unsubscribe = onSnapshot(
      docRef,
      () => {},
      (error) => {
        errors.push(error)
      }
    )

    // Simulate error by triggering a permission denial
    // In real implementation, this would depend on security rules
    await new Promise((resolve) => setTimeout(resolve, 50))

    unsubscribe()
  })

  it('should include document changes', async () => {
    const col = collection(db, 'items')
    await addDoc(col, { value: 1 })

    let changes: any[] = []
    const unsubscribe = onSnapshot(col, (snapshot) => {
      changes = snapshot.docChanges()
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(changes.length).toBeGreaterThan(0)
    expect(changes[0].type).toBe('added')

    unsubscribe()
  })

  it('should respect includeMetadataChanges option', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice' })

    let callCount = 0
    const unsubscribe = onSnapshot(
      docRef,
      { includeMetadataChanges: true },
      () => {
        callCount++
      }
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(callCount).toBeGreaterThan(0)

    unsubscribe()
  })
})

// ============================================================================
// WRITE BATCH TESTS
// ============================================================================

describe('WriteBatch', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should batch set operations', async () => {
    const batch = writeBatch(db)
    batch.set(doc(db, 'users/alice'), { name: 'Alice' })
    batch.set(doc(db, 'users/bob'), { name: 'Bob' })
    await batch.commit()

    const alice = await getDoc(doc(db, 'users/alice'))
    const bob = await getDoc(doc(db, 'users/bob'))
    expect(alice.exists).toBe(true)
    expect(bob.exists).toBe(true)
  })

  it('should batch update operations', async () => {
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', age: 30 })
    await setDoc(doc(db, 'users/bob'), { name: 'Bob', age: 25 })

    const batch = writeBatch(db)
    batch.update(doc(db, 'users/alice'), { age: 31 })
    batch.update(doc(db, 'users/bob'), { age: 26 })
    await batch.commit()

    const alice = await getDoc(doc(db, 'users/alice'))
    const bob = await getDoc(doc(db, 'users/bob'))
    expect(alice.data()?.age).toBe(31)
    expect(bob.data()?.age).toBe(26)
  })

  it('should batch delete operations', async () => {
    await setDoc(doc(db, 'users/alice'), { name: 'Alice' })
    await setDoc(doc(db, 'users/bob'), { name: 'Bob' })

    const batch = writeBatch(db)
    batch.delete(doc(db, 'users/alice'))
    batch.delete(doc(db, 'users/bob'))
    await batch.commit()

    const alice = await getDoc(doc(db, 'users/alice'))
    const bob = await getDoc(doc(db, 'users/bob'))
    expect(alice.exists).toBe(false)
    expect(bob.exists).toBe(false)
  })

  it('should chain batch operations', async () => {
    const batch = writeBatch(db)
      .set(doc(db, 'users/alice'), { name: 'Alice' })
      .set(doc(db, 'users/bob'), { name: 'Bob' })
      .delete(doc(db, 'users/charlie'))

    await batch.commit()
  })

  it('should support merge in batch set', async () => {
    await setDoc(doc(db, 'users/alice'), { name: 'Alice', age: 30 })

    const batch = writeBatch(db)
    batch.set(doc(db, 'users/alice'), { email: 'alice@example.com.ai' }, { merge: true })
    await batch.commit()

    const alice = await getDoc(doc(db, 'users/alice'))
    expect(alice.data()?.name).toBe('Alice')
    expect(alice.data()?.email).toBe('alice@example.com.ai')
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('runTransaction', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
    await setDoc(doc(db, 'accounts/alice'), { balance: 100 })
    await setDoc(doc(db, 'accounts/bob'), { balance: 50 })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should run transaction with reads and writes', async () => {
    await runTransaction(db, async (transaction) => {
      const aliceRef = doc(db, 'accounts/alice')
      const bobRef = doc(db, 'accounts/bob')

      const aliceSnap = await transaction.get(aliceRef)
      const bobSnap = await transaction.get(bobRef)

      const aliceBalance = aliceSnap.data()?.balance as number
      const bobBalance = bobSnap.data()?.balance as number

      transaction.update(aliceRef, { balance: aliceBalance - 20 })
      transaction.update(bobRef, { balance: bobBalance + 20 })
    })

    const alice = await getDoc(doc(db, 'accounts/alice'))
    const bob = await getDoc(doc(db, 'accounts/bob'))
    expect(alice.data()?.balance).toBe(80)
    expect(bob.data()?.balance).toBe(70)
  })

  it('should return transaction result', async () => {
    const result = await runTransaction(db, async (transaction) => {
      const aliceRef = doc(db, 'accounts/alice')
      const snap = await transaction.get(aliceRef)
      return snap.data()?.balance as number
    })

    expect(result).toBe(100)
  })

  it('should rollback on error', async () => {
    await expect(
      runTransaction(db, async (transaction) => {
        const aliceRef = doc(db, 'accounts/alice')
        transaction.update(aliceRef, { balance: 200 })
        throw new Error('Simulated failure')
      })
    ).rejects.toThrow()

    const alice = await getDoc(doc(db, 'accounts/alice'))
    expect(alice.data()?.balance).toBe(100)
  })

  it('should retry on contention', async () => {
    // This test verifies retry behavior
    let attempts = 0

    await runTransaction(
      db,
      async (transaction) => {
        attempts++
        const ref = doc(db, 'accounts/alice')
        const snap = await transaction.get(ref)
        transaction.update(ref, { balance: (snap.data()?.balance as number) + 1 })
      },
      { maxAttempts: 3 }
    )

    expect(attempts).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// FIELD VALUE TESTS
// ============================================================================

describe('Field Values', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should set server timestamp', async () => {
    const docRef = doc(db, 'events/1')
    await setDoc(docRef, { createdAt: serverTimestamp() })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.createdAt).toBeDefined()
  })

  it('should delete field', async () => {
    const docRef = doc(db, 'users/alice')
    await setDoc(docRef, { name: 'Alice', age: 30 })
    await updateDoc(docRef, { age: deleteField() })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.name).toBe('Alice')
    expect(snapshot.data()?.age).toBeUndefined()
  })

  it('should increment number', async () => {
    const docRef = doc(db, 'counters/visits')
    await setDoc(docRef, { count: 10 })
    await updateDoc(docRef, { count: increment(5) })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.count).toBe(15)
  })

  it('should increment with negative', async () => {
    const docRef = doc(db, 'counters/visits')
    await setDoc(docRef, { count: 10 })
    await updateDoc(docRef, { count: increment(-3) })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.count).toBe(7)
  })

  it('should union arrays', async () => {
    const docRef = doc(db, 'posts/1')
    await setDoc(docRef, { tags: ['tech', 'news'] })
    await updateDoc(docRef, { tags: arrayUnion('sports', 'tech') })

    const snapshot = await getDoc(docRef)
    const tags = snapshot.data()?.tags as string[]
    expect(tags).toContain('tech')
    expect(tags).toContain('news')
    expect(tags).toContain('sports')
    expect(tags.filter((t) => t === 'tech').length).toBe(1) // No duplicates
  })

  it('should remove from arrays', async () => {
    const docRef = doc(db, 'posts/1')
    await setDoc(docRef, { tags: ['tech', 'news', 'sports'] })
    await updateDoc(docRef, { tags: arrayRemove('news', 'sports') })

    const snapshot = await getDoc(docRef)
    const tags = snapshot.data()?.tags as string[]
    expect(tags).toEqual(['tech'])
  })

  // FieldValue operations in setDoc with merge
  it('should increment in setDoc with merge', async () => {
    const docRef = doc(db, 'counters/views')
    await setDoc(docRef, { count: 10 })
    await setDoc(docRef, { count: increment(5) }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.count).toBe(15)
  })

  it('should increment from zero when field missing in setDoc with merge', async () => {
    const docRef = doc(db, 'counters/new')
    await setDoc(docRef, { name: 'test' })
    await setDoc(docRef, { count: increment(5) }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.count).toBe(5)
    expect(snapshot.data()?.name).toBe('test')
  })

  it('should arrayUnion in setDoc with merge', async () => {
    const docRef = doc(db, 'posts/merge1')
    await setDoc(docRef, { tags: ['a', 'b'] })
    await setDoc(docRef, { tags: arrayUnion('c', 'b') }, { merge: true })

    const snapshot = await getDoc(docRef)
    const tags = snapshot.data()?.tags as string[]
    expect(tags).toContain('a')
    expect(tags).toContain('b')
    expect(tags).toContain('c')
    expect(tags.filter((t) => t === 'b').length).toBe(1) // No duplicates
  })

  it('should arrayUnion to empty array when field missing in setDoc with merge', async () => {
    const docRef = doc(db, 'posts/merge2')
    await setDoc(docRef, { title: 'test' })
    await setDoc(docRef, { tags: arrayUnion('a', 'b') }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.tags).toEqual(['a', 'b'])
    expect(snapshot.data()?.title).toBe('test')
  })

  it('should arrayRemove in setDoc with merge', async () => {
    const docRef = doc(db, 'posts/merge3')
    await setDoc(docRef, { tags: ['a', 'b', 'c'] })
    await setDoc(docRef, { tags: arrayRemove('a') }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.tags).toEqual(['b', 'c'])
  })

  it('should handle arrayRemove when field missing in setDoc with merge', async () => {
    const docRef = doc(db, 'posts/merge4')
    await setDoc(docRef, { title: 'test' })
    await setDoc(docRef, { tags: arrayRemove('a') }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.tags).toEqual([])
    expect(snapshot.data()?.title).toBe('test')
  })

  it('should handle multiple FieldValue operations in setDoc with merge', async () => {
    const docRef = doc(db, 'items/multi')
    await setDoc(docRef, { count: 10, tags: ['x'], name: 'original' })
    await setDoc(
      docRef,
      {
        count: increment(5),
        tags: arrayUnion('y'),
        name: 'updated',
      },
      { merge: true }
    )

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.count).toBe(15)
    expect(snapshot.data()?.tags).toContain('x')
    expect(snapshot.data()?.tags).toContain('y')
    expect(snapshot.data()?.name).toBe('updated')
  })

  it('should deleteField in setDoc with merge', async () => {
    const docRef = doc(db, 'users/del')
    await setDoc(docRef, { name: 'Alice', age: 30, city: 'NYC' })
    await setDoc(docRef, { age: deleteField() }, { merge: true })

    const snapshot = await getDoc(docRef)
    expect(snapshot.data()?.name).toBe('Alice')
    expect(snapshot.data()?.city).toBe('NYC')
    expect(snapshot.data()?.age).toBeUndefined()
  })
})

// ============================================================================
// TIMESTAMP & GEO TESTS
// ============================================================================

describe('Timestamp', () => {
  it('should create from date', () => {
    const date = new Date('2025-01-01T00:00:00Z')
    const ts = TimestampClass.fromDate(date)
    expect(ts.toDate().getTime()).toBe(date.getTime())
  })

  it('should create from millis', () => {
    const millis = 1704067200000
    const ts = TimestampClass.fromMillis(millis)
    expect(ts.toMillis()).toBe(millis)
  })

  it('should create now', () => {
    const before = Date.now()
    const ts = TimestampClass.now()
    const after = Date.now()
    expect(ts.toMillis()).toBeGreaterThanOrEqual(before)
    expect(ts.toMillis()).toBeLessThanOrEqual(after)
  })

  it('should check equality', () => {
    const ts1 = TimestampClass.fromMillis(1704067200000)
    const ts2 = TimestampClass.fromMillis(1704067200000)
    const ts3 = TimestampClass.fromMillis(1704067201000)
    expect(ts1.isEqual(ts2)).toBe(true)
    expect(ts1.isEqual(ts3)).toBe(false)
  })

  it('should convert to JSON', () => {
    const ts = TimestampClass.fromMillis(1704067200000)
    const json = ts.toJSON()
    expect(json).toHaveProperty('seconds')
    expect(json).toHaveProperty('nanoseconds')
  })
})

describe('GeoPoint', () => {
  it('should create geo point', () => {
    const point = new GeoPointClass(37.7749, -122.4194)
    expect(point.latitude).toBe(37.7749)
    expect(point.longitude).toBe(-122.4194)
  })

  it('should validate latitude range', () => {
    expect(() => new GeoPointClass(91, 0)).toThrow()
    expect(() => new GeoPointClass(-91, 0)).toThrow()
  })

  it('should validate longitude range', () => {
    expect(() => new GeoPointClass(0, 181)).toThrow()
    expect(() => new GeoPointClass(0, -181)).toThrow()
  })

  it('should check equality', () => {
    const p1 = new GeoPointClass(37.7749, -122.4194)
    const p2 = new GeoPointClass(37.7749, -122.4194)
    const p3 = new GeoPointClass(40.7128, -74.0060)
    expect(p1.isEqual(p2)).toBe(true)
    expect(p1.isEqual(p3)).toBe(false)
  })

  it('should convert to JSON', () => {
    const point = new GeoPointClass(37.7749, -122.4194)
    const json = point.toJSON()
    expect(json.latitude).toBe(37.7749)
    expect(json.longitude).toBe(-122.4194)
  })
})

describe('FieldPath', () => {
  it('should create field path', () => {
    const path = new FieldPathClass('address', 'city')
    expect(path).toBeDefined()
  })

  it('should check equality', () => {
    const p1 = new FieldPathClass('address', 'city')
    const p2 = new FieldPathClass('address', 'city')
    const p3 = new FieldPathClass('address', 'zip')
    expect(p1.isEqual(p2)).toBe(true)
    expect(p1.isEqual(p3)).toBe(false)
  })

  it('should get document ID field path', () => {
    const path = documentId()
    expect(path).toBeDefined()
  })
})

describe('Bytes', () => {
  it('should create from base64', () => {
    const bytes = Bytes.fromBase64String('SGVsbG8gV29ybGQ=')
    expect(bytes.toBase64()).toBe('SGVsbG8gV29ybGQ=')
  })

  it('should create from Uint8Array', () => {
    const array = new Uint8Array([72, 101, 108, 108, 111])
    const bytes = Bytes.fromUint8Array(array)
    expect(bytes.toUint8Array()).toEqual(array)
  })

  it('should check equality', () => {
    const b1 = Bytes.fromBase64String('SGVsbG8=')
    const b2 = Bytes.fromBase64String('SGVsbG8=')
    const b3 = Bytes.fromBase64String('V29ybGQ=')
    expect(b1.isEqual(b2)).toBe(true)
    expect(b1.isEqual(b3)).toBe(false)
  })
})

// ============================================================================
// AGGREGATION TESTS
// ============================================================================

describe('Aggregation', () => {
  let db: Firestore

  beforeEach(async () => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)

    await setDoc(doc(db, 'products/1'), { name: 'A', price: 10, quantity: 5 })
    await setDoc(doc(db, 'products/2'), { name: 'B', price: 20, quantity: 3 })
    await setDoc(doc(db, 'products/3'), { name: 'C', price: 15, quantity: 7 })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should count documents', async () => {
    const col = collection(db, 'products')
    const snapshot = await getCountFromServer(col)
    expect(snapshot.data().count).toBe(3)
  })

  it('should count with query', async () => {
    const q = query(collection(db, 'products'), where('price', '>', 12))
    const snapshot = await getCountFromServer(q)
    expect(snapshot.data().count).toBe(2)
  })

  it('should get multiple aggregates', async () => {
    const col = collection(db, 'products')
    const snapshot = await getAggregateFromServer(col, {
      totalPrice: sum('price'),
      avgPrice: average('price'),
      productCount: count(),
    })

    const data = snapshot.data()
    expect(data.totalPrice).toBe(45)
    expect(data.avgPrice).toBe(15)
    expect(data.productCount).toBe(3)
  })

  it('should handle empty collection', async () => {
    const col = collection(db, 'empty')
    const snapshot = await getCountFromServer(col)
    expect(snapshot.data().count).toBe(0)
  })
})

// ============================================================================
// PERSISTENCE TESTS
// ============================================================================

describe('Persistence', () => {
  let db: Firestore

  beforeEach(() => {
    const app = initializeApp({ projectId: 'test-project' })
    db = getFirestore(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should enable IndexedDB persistence', async () => {
    await expect(enableIndexedDbPersistence(db)).resolves.not.toThrow()
  })

  it('should enable multi-tab persistence', async () => {
    await expect(enableMultiTabIndexedDbPersistence(db)).resolves.not.toThrow()
  })

  it('should clear persistence', async () => {
    await expect(clearIndexedDbPersistence(db)).resolves.not.toThrow()
  })

  it('should wait for pending writes', async () => {
    await setDoc(doc(db, 'test/doc'), { value: 1 })
    await expect(waitForPendingWrites(db)).resolves.not.toThrow()
  })

  it('should terminate Firestore', async () => {
    await expect(terminate(db)).resolves.not.toThrow()
  })
})

// ============================================================================
// REALTIME DATABASE TESTS
// ============================================================================

describe('Realtime Database', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should get database instance', () => {
    expect(db).toBeDefined()
    expect(db.type).toBe('database')
  })

  it('should get database from default app', () => {
    const defaultDb = getDatabase()
    expect(defaultDb.app.name).toBe('[DEFAULT]')
  })
})

describe('Database Reference', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should create ref at root', () => {
    const rootRef = ref(db)
    expect(rootRef.key).toBe(null)
    expect(rootRef.path).toBe('/')
  })

  it('should create ref at path', () => {
    const usersRef = ref(db, 'users')
    expect(usersRef.key).toBe('users')
    expect(usersRef.path).toBe('/users')
  })

  it('should create nested ref', () => {
    const aliceRef = ref(db, 'users/alice')
    expect(aliceRef.key).toBe('alice')
    expect(aliceRef.path).toBe('/users/alice')
  })

  it('should get child ref', () => {
    const usersRef = ref(db, 'users')
    const aliceRef = child(usersRef, 'alice')
    expect(aliceRef.key).toBe('alice')
    expect(aliceRef.path).toBe('/users/alice')
  })

  it('should get parent ref', () => {
    const aliceRef = ref(db, 'users/alice')
    expect(aliceRef.parent?.key).toBe('users')
  })

  it('should get root ref', () => {
    const aliceRef = ref(db, 'users/alice')
    expect(aliceRef.root.key).toBe(null)
  })

  it('should push new child', () => {
    const messagesRef = ref(db, 'messages')
    const newRef = push(messagesRef)
    expect(newRef.key).toBeDefined()
    expect(newRef.key?.length).toBeGreaterThan(0)
  })

  it('should check equality', () => {
    const ref1 = ref(db, 'users/alice')
    const ref2 = ref(db, 'users/alice')
    const ref3 = ref(db, 'users/bob')
    expect(ref1.isEqual(ref2)).toBe(true)
    expect(ref1.isEqual(ref3)).toBe(false)
  })

  it('should convert to string', () => {
    const usersRef = ref(db, 'users')
    expect(usersRef.toString()).toContain('users')
  })
})

describe('Database CRUD', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should set data', async () => {
    const userRef = ref(db, 'users/alice')
    await set(userRef, { name: 'Alice', age: 30 })

    const snapshot = await get(userRef)
    expect(snapshot.exists()).toBe(true)
    expect(snapshot.val()).toEqual({ name: 'Alice', age: 30 })
  })

  it('should get data', async () => {
    await set(ref(db, 'users/bob'), { name: 'Bob' })

    const snapshot = await get(ref(db, 'users/bob'))
    expect(snapshot.val()?.name).toBe('Bob')
  })

  it('should return null for non-existent', async () => {
    const snapshot = await get(ref(db, 'nonexistent'))
    expect(snapshot.exists()).toBe(false)
    expect(snapshot.val()).toBe(null)
  })

  it('should update data', async () => {
    await set(ref(db, 'users/alice'), { name: 'Alice', age: 30 })
    await update(ref(db, 'users/alice'), { age: 31 })

    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.val()?.age).toBe(31)
    expect(snapshot.val()?.name).toBe('Alice')
  })

  it('should update multiple paths', async () => {
    await set(ref(db, 'users/alice'), { name: 'Alice' })
    await set(ref(db, 'users/bob'), { name: 'Bob' })

    await update(ref(db), {
      'users/alice/age': 30,
      'users/bob/age': 25,
    })

    const alice = await get(ref(db, 'users/alice'))
    const bob = await get(ref(db, 'users/bob'))
    expect(alice.val()?.age).toBe(30)
    expect(bob.val()?.age).toBe(25)
  })

  it('should remove data', async () => {
    await set(ref(db, 'users/alice'), { name: 'Alice' })
    await remove(ref(db, 'users/alice'))

    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.exists()).toBe(false)
  })

  it('should push and set', async () => {
    const messagesRef = ref(db, 'messages')
    const newRef = push(messagesRef)
    await set(newRef, { text: 'Hello', timestamp: Date.now() })

    const snapshot = await get(newRef)
    expect(snapshot.val()?.text).toBe('Hello')
  })
})

describe('Database Listeners', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should listen with onValue', async () => {
    const userRef = ref(db, 'users/alice')
    await set(userRef, { name: 'Alice' })

    const snapshots: DataSnapshot[] = []
    const unsubscribe = onValue(userRef, (snapshot) => {
      snapshots.push(snapshot)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots[0].val()?.name).toBe('Alice')

    unsubscribe()
  })

  it('should listen with onChildAdded', async () => {
    const usersRef = ref(db, 'users')

    const added: DataSnapshot[] = []
    const unsubscribe = onChildAdded(usersRef, (snapshot) => {
      added.push(snapshot)
    })

    await set(ref(db, 'users/alice'), { name: 'Alice' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(added.length).toBeGreaterThan(0)

    unsubscribe()
  })

  it('should listen with onChildChanged', async () => {
    await set(ref(db, 'users/alice'), { name: 'Alice' })

    const changed: DataSnapshot[] = []
    const unsubscribe = onChildChanged(ref(db, 'users'), (snapshot) => {
      changed.push(snapshot)
    })

    await update(ref(db, 'users/alice'), { name: 'Alicia' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    unsubscribe()
  })

  it('should listen with onChildRemoved', async () => {
    await set(ref(db, 'users/alice'), { name: 'Alice' })

    const removed: DataSnapshot[] = []
    const unsubscribe = onChildRemoved(ref(db, 'users'), (snapshot) => {
      removed.push(snapshot)
    })

    await remove(ref(db, 'users/alice'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    unsubscribe()
  })

  it('should unsubscribe with off', async () => {
    const userRef = ref(db, 'users/alice')

    let callCount = 0
    const callback = () => {
      callCount++
    }

    onValue(userRef, callback)
    off(userRef, 'value', callback)

    await set(userRef, { name: 'Alice' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should not have been called after off
    expect(callCount).toBe(0)
  })
})

describe('Database Queries', () => {
  let db: Database

  beforeEach(async () => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)

    await set(ref(db, 'users/alice'), { name: 'Alice', age: 30 })
    await set(ref(db, 'users/bob'), { name: 'Bob', age: 25 })
    await set(ref(db, 'users/charlie'), { name: 'Charlie', age: 35 })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should order by child', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'))
    const snapshot = await get(q)

    const ages: number[] = []
    snapshot.forEach((child) => {
      ages.push(child.val()?.age as number)
    })
    expect(ages).toEqual([25, 30, 35])
  })

  it('should order by key', async () => {
    const q = dbQuery(ref(db, 'users'), orderByKey())
    const snapshot = await get(q)

    const keys: string[] = []
    snapshot.forEach((child) => {
      keys.push(child.key!)
    })
    expect(keys).toEqual(['alice', 'bob', 'charlie'])
  })

  it('should limit to first', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'), limitToFirst(2))
    const snapshot = await get(q)
    expect(snapshot.size).toBe(2)
  })

  it('should limit to last', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'), rtdbLimitToLast(2))
    const snapshot = await get(q)
    expect(snapshot.size).toBe(2)
  })

  it('should start at value', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'), rtdbStartAt(30))
    const snapshot = await get(q)
    expect(snapshot.size).toBe(2) // 30, 35
  })

  it('should end at value', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'), rtdbEndAt(30))
    const snapshot = await get(q)
    expect(snapshot.size).toBe(2) // 25, 30
  })

  it('should filter with equalTo', async () => {
    const q = dbQuery(ref(db, 'users'), orderByChild('age'), equalTo(30))
    const snapshot = await get(q)
    expect(snapshot.size).toBe(1)
    snapshot.forEach((child) => {
      expect(child.val()?.name).toBe('Alice')
    })
  })
})

describe('Database Transactions', () => {
  let db: Database

  beforeEach(async () => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
    await set(ref(db, 'counters/visits'), { count: 10 })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should run transaction', async () => {
    const counterRef = ref(db, 'counters/visits')

    const result = await runDbTransaction(counterRef, (current) => {
      if (current) {
        return { count: (current.count as number) + 1 }
      }
      return { count: 1 }
    })

    expect(result.committed).toBe(true)
    expect(result.snapshot.val()?.count).toBe(11)
  })

  it('should abort transaction on null return', async () => {
    const counterRef = ref(db, 'counters/visits')

    const result = await runDbTransaction(counterRef, () => {
      return // Return undefined to abort
    })

    expect(result.committed).toBe(false)
  })
})

describe('Database Priority', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should set with priority', async () => {
    const userRef = ref(db, 'users/alice')
    await setWithPriority(userRef, { name: 'Alice' }, 10)

    const snapshot = await get(userRef)
    expect(snapshot.getPriority()).toBe(10)
  })

  it('should set priority', async () => {
    const userRef = ref(db, 'users/alice')
    await set(userRef, { name: 'Alice' })
    await setPriority(userRef, 'high')

    const snapshot = await get(userRef)
    expect(snapshot.getPriority()).toBe('high')
  })

  it('should order by priority', async () => {
    await setWithPriority(ref(db, 'items/a'), { name: 'A' }, 3)
    await setWithPriority(ref(db, 'items/b'), { name: 'B' }, 1)
    await setWithPriority(ref(db, 'items/c'), { name: 'C' }, 2)

    const q = dbQuery(ref(db, 'items'), orderByPriority())
    const snapshot = await get(q)

    const names: string[] = []
    snapshot.forEach((child) => {
      names.push(child.val()?.name as string)
    })
    expect(names).toEqual(['B', 'C', 'A'])
  })
})

describe('Database Online/Offline', () => {
  let db: Database

  beforeEach(() => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should go offline', () => {
    expect(() => goOffline(db)).not.toThrow()
  })

  it('should go online', () => {
    goOffline(db)
    expect(() => goOnline(db)).not.toThrow()
  })
})

describe('DataSnapshot', () => {
  let db: Database

  beforeEach(async () => {
    const app = initializeApp({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
    })
    db = getDatabase(app)

    await set(ref(db, 'users/alice'), {
      name: 'Alice',
      address: { city: 'NYC', zip: '10001' },
      tags: ['admin', 'user'],
    })
  })

  afterEach(() => {
    deleteApp(getApp())
  })

  it('should get key', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.key).toBe('alice')
  })

  it('should check existence', async () => {
    const exists = await get(ref(db, 'users/alice'))
    const notExists = await get(ref(db, 'users/nonexistent'))
    expect(exists.exists()).toBe(true)
    expect(notExists.exists()).toBe(false)
  })

  it('should check hasChildren', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.hasChildren()).toBe(true)
  })

  it('should get child snapshot', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    const addressSnap = snapshot.child('address')
    expect(addressSnap.val()?.city).toBe('NYC')
  })

  it('should check hasChild', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.hasChild('name')).toBe(true)
    expect(snapshot.hasChild('nonexistent')).toBe(false)
  })

  it('should iterate with forEach', async () => {
    const snapshot = await get(ref(db, 'users'))
    let count = 0
    snapshot.forEach(() => {
      count++
    })
    expect(count).toBeGreaterThan(0)
  })

  it('should stop forEach on true return', async () => {
    await set(ref(db, 'items/a'), { v: 1 })
    await set(ref(db, 'items/b'), { v: 2 })
    await set(ref(db, 'items/c'), { v: 3 })

    const snapshot = await get(ref(db, 'items'))
    let count = 0
    snapshot.forEach(() => {
      count++
      return true // Stop iteration
    })
    expect(count).toBe(1)
  })

  it('should export value', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    const exported = snapshot.exportVal()
    expect(exported).toBeDefined()
  })

  it('should convert to JSON', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    const json = snapshot.toJSON()
    expect(json).toBeDefined()
    expect(json?.name).toBe('Alice')
  })

  it('should get size', async () => {
    const snapshot = await get(ref(db, 'users/alice'))
    expect(snapshot.size).toBeGreaterThan(0)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('should throw FirestoreError with code', async () => {
    const app = initializeApp({ projectId: 'test-project' })
    const db = getFirestore(app)

    // Try to update a non-existent document
    const docRef = doc(db, 'nonexistent/doc')

    try {
      await updateDoc(docRef, { field: 'value' })
    } catch (error) {
      expect(error).toBeInstanceOf(FirestoreError)
      expect((error as FirestoreError).code).toBe('not-found')
    }

    deleteApp(app)
  })
})
