/**
 * Firestore Advanced Query tests for @chdb/firebase-compat
 *
 * Tests advanced query features including:
 * - Compound queries (multiple where + orderBy)
 * - Collection group queries
 * - Subcollections (nested data operations)
 * - Batch writes
 * - Transactions
 * - Aggregate queries (count, sum, average)
 * - Field types (Timestamp, GeoPoint, serverTimestamp)
 * - Error handling
 *
 * These are RED tests - they are expected to fail until the features are implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type {
  Firestore,
  CollectionReference,
  DocumentReference,
  Query,
  QuerySnapshot,
  WriteBatch,
  Transaction,
} from 'firebase/firestore';

// Import from our package
import {
  initializeApp,
  getFirestore,
  deleteApp,
  type FirebaseOptions,
} from '@chdb/firebase-compat';

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from '@chdb/firebase-compat/firestore';

// These imports will fail until implemented - we'll test for their existence
// import {
//   collectionGroup,
//   writeBatch,
//   runTransaction,
//   getCountFromServer,
//   getAggregateFromServer,
//   sum,
//   average,
//   Timestamp,
//   GeoPoint,
//   serverTimestamp,
// } from '@chdb/firebase-compat/firestore';

// =============================================================================
// Section 1: Compound Queries (8 tests)
// =============================================================================

describe('Compound Queries', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'compound-query-test',
    };
    app = initializeApp(config, `compound-query-test-${Date.now()}`);
    db = getFirestore(app);

    // Seed test data for compound queries
    const productsRef = collection(db, 'products');
    await setDoc(doc(productsRef, 'p1'), {
      name: 'Laptop',
      category: 'electronics',
      price: 999,
      rating: 4.5,
      inStock: true,
      brand: 'TechCorp'
    });
    await setDoc(doc(productsRef, 'p2'), {
      name: 'Phone',
      category: 'electronics',
      price: 699,
      rating: 4.8,
      inStock: true,
      brand: 'MobileInc'
    });
    await setDoc(doc(productsRef, 'p3'), {
      name: 'Headphones',
      category: 'electronics',
      price: 199,
      rating: 4.2,
      inStock: false,
      brand: 'AudioMax'
    });
    await setDoc(doc(productsRef, 'p4'), {
      name: 'Desk',
      category: 'furniture',
      price: 450,
      rating: 4.0,
      inStock: true,
      brand: 'OfficePro'
    });
    await setDoc(doc(productsRef, 'p5'), {
      name: 'Chair',
      category: 'furniture',
      price: 250,
      rating: 3.8,
      inStock: true,
      brand: 'ComfortZone'
    });
    await setDoc(doc(productsRef, 'p6'), {
      name: 'Monitor',
      category: 'electronics',
      price: 350,
      rating: 4.6,
      inStock: true,
      brand: 'TechCorp'
    });
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('filters with equality + range on same field (==, >)', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('category', '==', 'electronics'),
      where('price', '>', 200),
      orderBy('price')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    expect(snapshot.size).toBe(3); // Laptop, Phone, Monitor
    snapshot.forEach((doc) => {
      expect(doc.data().category).toBe('electronics');
      expect(doc.data().price).toBeGreaterThan(200);
    });
    // Verify order
    const prices = snapshot.docs.map(d => d.data().price);
    expect(prices).toEqual([350, 699, 999]);
  });

  it('filters with multiple equality conditions on different fields', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('category', '==', 'electronics'),
      where('inStock', '==', true),
      where('brand', '==', 'TechCorp')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    expect(snapshot.size).toBe(2); // Laptop and Monitor
    snapshot.forEach((doc) => {
      expect(doc.data().category).toBe('electronics');
      expect(doc.data().inStock).toBe(true);
      expect(doc.data().brand).toBe('TechCorp');
    });
  });

  it('combines equality with range and ordering on different fields', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('category', '==', 'electronics'),
      where('rating', '>=', 4.5),
      orderBy('rating', 'desc'),
      orderBy('price', 'asc')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    expect(snapshot.size).toBe(3); // Phone (4.8), Monitor (4.6), Laptop (4.5)
    const names = snapshot.docs.map(d => d.data().name);
    expect(names[0]).toBe('Phone'); // Highest rating
  });

  it('uses compound inequality on single field with ordering', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('price', '>=', 200),
      where('price', '<=', 500),
      orderBy('price')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    // Should include: Headphones (199 excluded), Chair (250), Monitor (350), Desk (450)
    expect(snapshot.size).toBe(3);
    snapshot.forEach((doc) => {
      expect(doc.data().price).toBeGreaterThanOrEqual(200);
      expect(doc.data().price).toBeLessThanOrEqual(500);
    });
  });

  it('combines where with multiple orderBy for deterministic sorting', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('inStock', '==', true),
      orderBy('category'),
      orderBy('price', 'desc')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    expect(snapshot.size).toBe(5); // All except Headphones
    // Electronics should come first, then furniture
    const first = snapshot.docs[0].data();
    expect(first.category).toBe('electronics');
  });

  it('handles compound query with limit', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('category', '==', 'electronics'),
      where('price', '>', 100),
      orderBy('price', 'desc'),
      limit(2)
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    expect(snapshot.size).toBe(2);
    const prices = snapshot.docs.map(d => d.data().price);
    expect(prices).toEqual([999, 699]); // Laptop, Phone (top 2 most expensive electronics)
  });

  it('filters using != combined with range query', async () => {
    const productsRef = collection(db, 'products');
    const q = query(
      productsRef,
      where('category', '!=', 'furniture'),
      where('price', '<', 400),
      orderBy('category'),
      orderBy('price')
    );

    const snapshot: QuerySnapshot = await getDocs(q);

    // Should include electronics < 400: Headphones (199), Monitor (350)
    expect(snapshot.size).toBe(2);
    snapshot.forEach((doc) => {
      expect(doc.data().category).not.toBe('furniture');
      expect(doc.data().price).toBeLessThan(400);
    });
  });

  it('validates compound query constraint ordering (Firebase requires range on orderBy field)', async () => {
    const productsRef = collection(db, 'products');

    // This query pattern requires price in orderBy since we have range on price
    const q = query(
      productsRef,
      where('category', '==', 'electronics'),
      where('price', '>', 100),
      orderBy('price'),
      orderBy('name')
    );

    const snapshot: QuerySnapshot = await getDocs(q);
    expect(snapshot.size).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 2: Collection Group Queries (5 tests)
// =============================================================================

describe('Collection Group Queries', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'collection-group-test',
    };
    app = initializeApp(config, `collection-group-test-${Date.now()}`);
    db = getFirestore(app);

    // Create nested data structure for collection group queries
    // users/alice/messages/m1
    // users/alice/messages/m2
    // users/bob/messages/m3
    // teams/team1/messages/m4
    const alice = doc(db, 'users', 'alice');
    await setDoc(alice, { name: 'Alice' });
    const aliceMessages = collection(alice, 'messages');
    await setDoc(doc(aliceMessages, 'm1'), { text: 'Hello from Alice', timestamp: 1000, read: true });
    await setDoc(doc(aliceMessages, 'm2'), { text: 'Second message', timestamp: 2000, read: false });

    const bob = doc(db, 'users', 'bob');
    await setDoc(bob, { name: 'Bob' });
    const bobMessages = collection(bob, 'messages');
    await setDoc(doc(bobMessages, 'm3'), { text: 'Hello from Bob', timestamp: 1500, read: true });

    const team1 = doc(db, 'teams', 'team1');
    await setDoc(team1, { name: 'Team One' });
    const teamMessages = collection(team1, 'messages');
    await setDoc(doc(teamMessages, 'm4'), { text: 'Team announcement', timestamp: 3000, read: false });
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('queries all subcollections with same name using collectionGroup', async () => {
    // This test requires collectionGroup to be implemented
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    const messagesQuery = collectionGroup(db, 'messages');
    const snapshot: QuerySnapshot = await getDocs(messagesQuery);

    expect(snapshot.size).toBe(4); // All messages across all parents
  });

  it('filters collection group with where clause', async () => {
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    const messagesQuery = query(
      collectionGroup(db, 'messages'),
      where('read', '==', false)
    );
    const snapshot: QuerySnapshot = await getDocs(messagesQuery);

    expect(snapshot.size).toBe(2); // m2 and m4
    snapshot.forEach((doc) => {
      expect(doc.data().read).toBe(false);
    });
  });

  it('orders collection group results', async () => {
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    const messagesQuery = query(
      collectionGroup(db, 'messages'),
      orderBy('timestamp', 'desc')
    );
    const snapshot: QuerySnapshot = await getDocs(messagesQuery);

    const timestamps = snapshot.docs.map(d => d.data().timestamp);
    expect(timestamps).toEqual([3000, 2000, 1500, 1000]);
  });

  it('combines collection group with compound query', async () => {
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    const messagesQuery = query(
      collectionGroup(db, 'messages'),
      where('read', '==', true),
      orderBy('timestamp'),
      limit(1)
    );
    const snapshot: QuerySnapshot = await getDocs(messagesQuery);

    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().text).toBe('Hello from Alice'); // timestamp 1000
  });

  it('returns document references with correct paths from collection group', async () => {
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    const messagesQuery = collectionGroup(db, 'messages');
    const snapshot: QuerySnapshot = await getDocs(messagesQuery);

    const paths = snapshot.docs.map(d => d.ref.path);

    // Should have proper nested paths
    expect(paths).toContain('users/alice/messages/m1');
    expect(paths).toContain('users/alice/messages/m2');
    expect(paths).toContain('users/bob/messages/m3');
    expect(paths).toContain('teams/team1/messages/m4');
  });
});

// =============================================================================
// Section 3: Subcollections (6 tests)
// =============================================================================

describe('Subcollections', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'subcollection-test',
    };
    app = initializeApp(config, `subcollection-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('creates and reads documents in subcollections', async () => {
    const userRef = doc(db, 'users', 'user1');
    await setDoc(userRef, { name: 'Test User' });

    const ordersRef = collection(userRef, 'orders');
    const orderDoc = await addDoc(ordersRef, { total: 99.99, status: 'pending' });

    const orderSnapshot = await getDoc(orderDoc);

    expect(orderSnapshot.exists()).toBe(true);
    expect(orderSnapshot.data()?.total).toBe(99.99);
    expect(orderDoc.path).toBe(`users/user1/orders/${orderDoc.id}`);
  });

  it('queries documents within a subcollection', async () => {
    const userRef = doc(db, 'users', 'user2');
    await setDoc(userRef, { name: 'Shopper' });

    const ordersRef = collection(userRef, 'orders');
    await setDoc(doc(ordersRef, 'o1'), { total: 50, status: 'completed' });
    await setDoc(doc(ordersRef, 'o2'), { total: 150, status: 'pending' });
    await setDoc(doc(ordersRef, 'o3'), { total: 75, status: 'completed' });

    const completedOrders = query(ordersRef, where('status', '==', 'completed'));
    const snapshot = await getDocs(completedOrders);

    expect(snapshot.size).toBe(2);
    snapshot.forEach((doc) => {
      expect(doc.data().status).toBe('completed');
    });
  });

  it('handles deeply nested subcollections (3+ levels)', async () => {
    const orgRef = doc(db, 'organizations', 'org1');
    await setDoc(orgRef, { name: 'Acme Corp' });

    const deptRef = doc(collection(orgRef, 'departments'), 'engineering');
    await setDoc(deptRef, { name: 'Engineering' });

    const teamRef = doc(collection(deptRef, 'teams'), 'frontend');
    await setDoc(teamRef, { name: 'Frontend Team' });

    const memberRef = doc(collection(teamRef, 'members'), 'john');
    await setDoc(memberRef, { name: 'John Doe', role: 'developer' });

    const memberSnapshot = await getDoc(memberRef);

    expect(memberSnapshot.exists()).toBe(true);
    expect(memberSnapshot.data()?.name).toBe('John Doe');
    expect(memberRef.path).toBe('organizations/org1/departments/engineering/teams/frontend/members/john');
  });

  it('updates documents in subcollections', async () => {
    const userRef = doc(db, 'users', 'user3');
    await setDoc(userRef, { name: 'Updater' });

    const postsRef = collection(userRef, 'posts');
    const postRef = doc(postsRef, 'post1');
    await setDoc(postRef, { title: 'Original', likes: 0 });

    await updateDoc(postRef, { likes: 10 });

    const postSnapshot = await getDoc(postRef);
    expect(postSnapshot.data()?.likes).toBe(10);
    expect(postSnapshot.data()?.title).toBe('Original');
  });

  it('deletes documents from subcollections', async () => {
    const userRef = doc(db, 'users', 'user4');
    await setDoc(userRef, { name: 'Deleter' });

    const commentsRef = collection(userRef, 'comments');
    const commentRef = doc(commentsRef, 'c1');
    await setDoc(commentRef, { text: 'To be deleted' });

    await deleteDoc(commentRef);

    const commentSnapshot = await getDoc(commentRef);
    expect(commentSnapshot.exists()).toBe(false);
  });

  it('parent document reference is accessible from subcollection', async () => {
    const userRef = doc(db, 'users', 'user5');
    await setDoc(userRef, { name: 'Parent User' });

    const reviewsRef = collection(userRef, 'reviews');
    const reviewDoc = doc(reviewsRef, 'r1');

    // Navigate back to parent
    const parentCollection = reviewDoc.parent;
    const parentDoc = parentCollection.parent;

    expect(parentDoc).not.toBeNull();
    expect(parentDoc?.id).toBe('user5');
    expect(parentDoc?.path).toBe('users/user5');
  });
});

// =============================================================================
// Section 4: Batch Writes (6 tests)
// =============================================================================

describe('Batch Writes', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'batch-write-test',
    };
    app = initializeApp(config, `batch-write-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('creates multiple documents atomically with batch.set()', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    const batch: WriteBatch = writeBatch(db);

    batch.set(doc(db, 'users', 'batch1'), { name: 'Alice', age: 25 });
    batch.set(doc(db, 'users', 'batch2'), { name: 'Bob', age: 30 });
    batch.set(doc(db, 'users', 'batch3'), { name: 'Charlie', age: 35 });

    await batch.commit();

    const usersSnapshot = await getDocs(collection(db, 'users'));
    expect(usersSnapshot.size).toBe(3);
  });

  it('updates multiple documents atomically with batch.update()', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    // Create documents first
    await setDoc(doc(db, 'scores', 's1'), { player: 'A', score: 100 });
    await setDoc(doc(db, 'scores', 's2'), { player: 'B', score: 200 });

    const batch: WriteBatch = writeBatch(db);
    batch.update(doc(db, 'scores', 's1'), { score: 150 });
    batch.update(doc(db, 'scores', 's2'), { score: 250 });
    await batch.commit();

    const s1 = await getDoc(doc(db, 'scores', 's1'));
    const s2 = await getDoc(doc(db, 'scores', 's2'));

    expect(s1.data()?.score).toBe(150);
    expect(s2.data()?.score).toBe(250);
  });

  it('deletes multiple documents atomically with batch.delete()', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    // Create documents first
    await setDoc(doc(db, 'temp', 't1'), { data: 'one' });
    await setDoc(doc(db, 'temp', 't2'), { data: 'two' });
    await setDoc(doc(db, 'temp', 't3'), { data: 'three' });

    const batch: WriteBatch = writeBatch(db);
    batch.delete(doc(db, 'temp', 't1'));
    batch.delete(doc(db, 'temp', 't2'));
    await batch.commit();

    const tempSnapshot = await getDocs(collection(db, 'temp'));
    expect(tempSnapshot.size).toBe(1);
    expect(tempSnapshot.docs[0].id).toBe('t3');
  });

  it('combines set, update, and delete in single batch', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    // Setup
    await setDoc(doc(db, 'mixed', 'm1'), { status: 'old' });
    await setDoc(doc(db, 'mixed', 'm2'), { status: 'to-delete' });

    const batch: WriteBatch = writeBatch(db);
    batch.set(doc(db, 'mixed', 'm3'), { status: 'new' });
    batch.update(doc(db, 'mixed', 'm1'), { status: 'updated' });
    batch.delete(doc(db, 'mixed', 'm2'));
    await batch.commit();

    const m1 = await getDoc(doc(db, 'mixed', 'm1'));
    const m2 = await getDoc(doc(db, 'mixed', 'm2'));
    const m3 = await getDoc(doc(db, 'mixed', 'm3'));

    expect(m1.data()?.status).toBe('updated');
    expect(m2.exists()).toBe(false);
    expect(m3.data()?.status).toBe('new');
  });

  it('batch.set() with merge option', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    await setDoc(doc(db, 'merge-test', 'd1'), { field1: 'original', field2: 'keep' });

    const batch: WriteBatch = writeBatch(db);
    batch.set(doc(db, 'merge-test', 'd1'), { field1: 'updated' }, { merge: true });
    await batch.commit();

    const snapshot = await getDoc(doc(db, 'merge-test', 'd1'));
    expect(snapshot.data()?.field1).toBe('updated');
    expect(snapshot.data()?.field2).toBe('keep');
  });

  it('batch fails atomically if any operation would fail', async () => {
    const { writeBatch } = await import('@chdb/firebase-compat/firestore');

    // Don't create 'nonexistent' doc - update should fail
    await setDoc(doc(db, 'atomic-test', 'exists'), { value: 1 });

    const batch: WriteBatch = writeBatch(db);
    batch.update(doc(db, 'atomic-test', 'exists'), { value: 2 });
    batch.update(doc(db, 'atomic-test', 'nonexistent'), { value: 3 }); // This should fail

    await expect(batch.commit()).rejects.toThrow();

    // Verify no partial updates happened
    const existsDoc = await getDoc(doc(db, 'atomic-test', 'exists'));
    expect(existsDoc.data()?.value).toBe(1); // Should remain unchanged
  });
});

// =============================================================================
// Section 5: Transactions (6 tests)
// =============================================================================

describe('Transactions', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'transaction-test',
    };
    app = initializeApp(config, `transaction-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('reads and writes atomically within transaction', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const counterRef = doc(db, 'counters', 'visits');
    await setDoc(counterRef, { count: 10 });

    await runTransaction(db, async (transaction: Transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const newCount = (counterDoc.data()?.count || 0) + 1;
      transaction.update(counterRef, { count: newCount });
    });

    const result = await getDoc(counterRef);
    expect(result.data()?.count).toBe(11);
  });

  it('transaction.get() returns current document state', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-read', 'd1');
    await setDoc(docRef, { value: 'original' });

    let readValue: string | undefined;

    await runTransaction(db, async (transaction: Transaction) => {
      const snapshot = await transaction.get(docRef);
      readValue = snapshot.data()?.value;
      transaction.update(docRef, { value: 'modified' });
    });

    expect(readValue).toBe('original');
  });

  it('transaction.set() creates new document', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-create', 'new-doc');

    await runTransaction(db, async (transaction: Transaction) => {
      transaction.set(docRef, { created: true, timestamp: Date.now() });
    });

    const result = await getDoc(docRef);
    expect(result.exists()).toBe(true);
    expect(result.data()?.created).toBe(true);
  });

  it('transaction.delete() removes document', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-delete', 'to-remove');
    await setDoc(docRef, { temporary: true });

    await runTransaction(db, async (transaction: Transaction) => {
      transaction.delete(docRef);
    });

    const result = await getDoc(docRef);
    expect(result.exists()).toBe(false);
  });

  it('returns value from transaction function', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-return', 'd1');
    await setDoc(docRef, { balance: 100 });

    const result = await runTransaction(db, async (transaction: Transaction) => {
      const snapshot = await transaction.get(docRef);
      const balance = snapshot.data()?.balance || 0;
      const newBalance = balance + 50;
      transaction.update(docRef, { balance: newBalance });
      return { oldBalance: balance, newBalance };
    });

    expect(result.oldBalance).toBe(100);
    expect(result.newBalance).toBe(150);
  });

  it('transaction aborts and rolls back on error', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-abort', 'd1');
    await setDoc(docRef, { value: 'initial' });

    await expect(
      runTransaction(db, async (transaction: Transaction) => {
        transaction.update(docRef, { value: 'modified' });
        throw new Error('Intentional abort');
      })
    ).rejects.toThrow('Intentional abort');

    // Document should be unchanged
    const result = await getDoc(docRef);
    expect(result.data()?.value).toBe('initial');
  });
});

// =============================================================================
// Section 6: Aggregate Queries (6 tests)
// =============================================================================

describe('Aggregate Queries', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'aggregate-test',
    };
    app = initializeApp(config, `aggregate-test-${Date.now()}`);
    db = getFirestore(app);

    // Seed data for aggregation tests
    const ordersRef = collection(db, 'orders');
    await setDoc(doc(ordersRef, 'o1'), { amount: 100, customer: 'alice', status: 'completed' });
    await setDoc(doc(ordersRef, 'o2'), { amount: 250, customer: 'bob', status: 'completed' });
    await setDoc(doc(ordersRef, 'o3'), { amount: 75, customer: 'alice', status: 'pending' });
    await setDoc(doc(ordersRef, 'o4'), { amount: 300, customer: 'charlie', status: 'completed' });
    await setDoc(doc(ordersRef, 'o5'), { amount: 150, customer: 'bob', status: 'completed' });
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('getCountFromServer() returns document count', async () => {
    const { getCountFromServer } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const snapshot = await getCountFromServer(ordersRef);

    expect(snapshot.data().count).toBe(5);
  });

  it('getCountFromServer() with query filter', async () => {
    const { getCountFromServer } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const completedQuery = query(ordersRef, where('status', '==', 'completed'));
    const snapshot = await getCountFromServer(completedQuery);

    expect(snapshot.data().count).toBe(4);
  });

  it('sum() aggregates numeric field', async () => {
    const { getAggregateFromServer, sum } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const result = await getAggregateFromServer(ordersRef, {
      totalAmount: sum('amount'),
    });

    expect(result.data().totalAmount).toBe(875); // 100 + 250 + 75 + 300 + 150
  });

  it('average() calculates mean of numeric field', async () => {
    const { getAggregateFromServer, average } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const result = await getAggregateFromServer(ordersRef, {
      avgAmount: average('amount'),
    });

    expect(result.data().avgAmount).toBe(175); // 875 / 5
  });

  it('combines multiple aggregations in single query', async () => {
    const { getAggregateFromServer, sum, average, count } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const completedQuery = query(ordersRef, where('status', '==', 'completed'));

    const result = await getAggregateFromServer(completedQuery, {
      totalRevenue: sum('amount'),
      averageOrder: average('amount'),
      orderCount: count(),
    });

    const data = result.data();
    expect(data.orderCount).toBe(4);
    expect(data.totalRevenue).toBe(800); // 100 + 250 + 300 + 150
    expect(data.averageOrder).toBe(200); // 800 / 4
  });

  it('aggregate with empty result returns appropriate values', async () => {
    const { getAggregateFromServer, sum, average, count } = await import('@chdb/firebase-compat/firestore');

    const ordersRef = collection(db, 'orders');
    const emptyQuery = query(ordersRef, where('status', '==', 'nonexistent'));

    const result = await getAggregateFromServer(emptyQuery, {
      total: sum('amount'),
      avg: average('amount'),
      cnt: count(),
    });

    const data = result.data();
    expect(data.cnt).toBe(0);
    expect(data.total).toBe(0);
    expect(data.avg).toBeNull(); // Average of empty set is null
  });
});

// =============================================================================
// Section 7: Field Types (5 tests)
// =============================================================================

describe('Field Types', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'field-types-test',
    };
    app = initializeApp(config, `field-types-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('Timestamp stores and retrieves date values', async () => {
    const { Timestamp } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'events', 'e1');
    const eventDate = new Date('2024-06-15T10:30:00Z');

    await setDoc(docRef, {
      name: 'Conference',
      scheduledAt: Timestamp.fromDate(eventDate),
    });

    const snapshot = await getDoc(docRef);
    const data = snapshot.data();

    expect(data?.scheduledAt).toBeInstanceOf(Timestamp);
    expect(data?.scheduledAt.toDate().toISOString()).toBe(eventDate.toISOString());
  });

  it('serverTimestamp() sets server-side timestamp on write', async () => {
    const { serverTimestamp, Timestamp } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'logs', 'l1');
    const beforeWrite = Date.now();

    await setDoc(docRef, {
      action: 'login',
      createdAt: serverTimestamp(),
    });

    const afterWrite = Date.now();
    const snapshot = await getDoc(docRef);
    const data = snapshot.data();

    expect(data?.createdAt).toBeInstanceOf(Timestamp);
    const serverTime = data?.createdAt.toMillis();
    expect(serverTime).toBeGreaterThanOrEqual(beforeWrite);
    expect(serverTime).toBeLessThanOrEqual(afterWrite + 1000); // Allow 1s tolerance
  });

  it('GeoPoint stores latitude and longitude', async () => {
    const { GeoPoint } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'locations', 'sf');
    const sfLocation = new GeoPoint(37.7749, -122.4194);

    await setDoc(docRef, {
      name: 'San Francisco',
      coordinates: sfLocation,
    });

    const snapshot = await getDoc(docRef);
    const data = snapshot.data();

    expect(data?.coordinates).toBeInstanceOf(GeoPoint);
    expect(data?.coordinates.latitude).toBeCloseTo(37.7749, 4);
    expect(data?.coordinates.longitude).toBeCloseTo(-122.4194, 4);
  });

  it('queries can filter by Timestamp', async () => {
    const { Timestamp } = await import('@chdb/firebase-compat/firestore');

    const tasksRef = collection(db, 'tasks');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await setDoc(doc(tasksRef, 't1'), {
      title: 'Past task',
      dueDate: Timestamp.fromDate(yesterday)
    });
    await setDoc(doc(tasksRef, 't2'), {
      title: 'Future task',
      dueDate: Timestamp.fromDate(tomorrow)
    });

    const overdueQuery = query(
      tasksRef,
      where('dueDate', '<', Timestamp.fromDate(now))
    );
    const snapshot = await getDocs(overdueQuery);

    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().title).toBe('Past task');
  });

  it('Timestamp supports seconds and nanoseconds precision', async () => {
    const { Timestamp } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'precise', 'p1');
    const seconds = 1718000000;
    const nanoseconds = 123456789;
    const preciseTimestamp = new Timestamp(seconds, nanoseconds);

    await setDoc(docRef, {
      preciseTime: preciseTimestamp,
    });

    const snapshot = await getDoc(docRef);
    const data = snapshot.data();

    expect(data?.preciseTime.seconds).toBe(seconds);
    expect(data?.preciseTime.nanoseconds).toBe(nanoseconds);
  });
});

// =============================================================================
// Section 8: Error Handling (3 tests)
// =============================================================================

describe('Error Handling', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'error-handling-test',
    };
    app = initializeApp(config, `error-handling-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('throws descriptive error for invalid compound query (inequality on different fields without index)', async () => {
    const productsRef = collection(db, 'products');

    // Firebase requires index for inequality filters on different fields
    // This should throw a descriptive error indicating index requirement
    const invalidQuery = query(
      productsRef,
      where('price', '>', 100),
      where('rating', '<', 4.0)
    );

    await expect(getDocs(invalidQuery)).rejects.toThrow(/index|compound|inequality/i);
  });

  it('throws error when transaction reads after writes', async () => {
    const { runTransaction } = await import('@chdb/firebase-compat/firestore');

    const docRef = doc(db, 'tx-order', 'd1');
    await setDoc(docRef, { value: 1 });

    // Firebase transactions require all reads before writes
    await expect(
      runTransaction(db, async (transaction: Transaction) => {
        transaction.update(docRef, { value: 2 }); // Write first
        await transaction.get(docRef); // Then read - should fail
      })
    ).rejects.toThrow(/read.*write|transaction.*order/i);
  });

  it('throws error for collection group on non-existent collection name', async () => {
    const { collectionGroup } = await import('@chdb/firebase-compat/firestore');

    // Query should succeed but return empty results (not throw)
    // However, if collection name contains invalid characters, it should throw
    expect(() => {
      collectionGroup(db, '');
    }).toThrow(/invalid|empty|collection/i);
  });
});
