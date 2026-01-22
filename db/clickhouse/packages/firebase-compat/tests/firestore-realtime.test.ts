/**
 * Firestore Realtime (onSnapshot) tests for @chdb/firebase-compat
 *
 * Tests document, collection, and query snapshot listeners using
 * actual Firebase types for type checking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type {
  Firestore,
  DocumentSnapshot,
  QuerySnapshot,
  DocumentData,
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
  onSnapshot,
  type Unsubscribe,
} from '@chdb/firebase-compat/firestore';

describe('Firestore Realtime: Document onSnapshot', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'realtime-doc-test',
    };
    app = initializeApp(config, `realtime-doc-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('initial snapshot fires immediately for existing document', async () => {
    const docRef = doc(db, 'users', 'user1');
    await setDoc(docRef, { name: 'Alice', age: 30 });

    const snapshots: DocumentSnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(docRef, (snapshot) => {
        snapshots.push(snapshot);
        unsubscribe();
        resolve();
      });
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].exists()).toBe(true);
    expect(snapshots[0].data()).toEqual({ name: 'Alice', age: 30 });
  });

  it('initial snapshot fires immediately for non-existent document', async () => {
    const docRef = doc(db, 'users', 'nonexistent');

    const snapshots: DocumentSnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(docRef, (snapshot) => {
        snapshots.push(snapshot);
        unsubscribe();
        resolve();
      });
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].exists()).toBe(false);
  });

  it('snapshot updates when document changes', async () => {
    const docRef = doc(db, 'users', 'user2');
    await setDoc(docRef, { name: 'Bob', score: 100 });

    const snapshots: DocumentSnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Update the document
    await updateDoc(docRef, { score: 200 });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].data()?.score).toBe(100);
    expect(snapshots[snapshots.length - 1].data()?.score).toBe(200);
  });

  it('snapshot updates when document is deleted', async () => {
    const docRef = doc(db, 'users', 'user3');
    await setDoc(docRef, { name: 'Charlie' });

    const snapshots: DocumentSnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Delete the document
    await deleteDoc(docRef);

    // Wait for delete snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].exists()).toBe(true);
    expect(snapshots[snapshots.length - 1].exists()).toBe(false);
  });

  it('unsubscribe stops updates', async () => {
    const docRef = doc(db, 'users', 'user4');
    await setDoc(docRef, { count: 1 });

    const snapshots: DocumentSnapshot[] = [];

    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      snapshots.push(snapshot);
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Unsubscribe
    unsubscribe();

    // Update should not trigger callback
    await setDoc(docRef, { count: 2 });

    // Wait a bit to ensure no more updates
    await new Promise((r) => setTimeout(r, 50));

    expect(snapshots).toHaveLength(1);
  });
});

describe('Firestore Realtime: Collection onSnapshot', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'realtime-col-test',
    };
    app = initializeApp(config, `realtime-col-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('initial snapshot contains all documents', async () => {
    const colRef = collection(db, 'items');
    await setDoc(doc(colRef, 'item1'), { name: 'Item 1' });
    await setDoc(doc(colRef, 'item2'), { name: 'Item 2' });

    const snapshots: QuerySnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(colRef, (snapshot) => {
        snapshots.push(snapshot);
        unsubscribe();
        resolve();
      });
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].size).toBe(2);
    expect(snapshots[0].docs.map(d => d.data().name).sort()).toEqual(['Item 1', 'Item 2']);
  });

  it('snapshot updates when document is added', async () => {
    const colRef = collection(db, 'products');
    await setDoc(doc(colRef, 'p1'), { name: 'Product 1' });

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Add a document
    await setDoc(doc(colRef, 'p2'), { name: 'Product 2' });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].size).toBe(1);
    expect(snapshots[snapshots.length - 1].size).toBe(2);
  });

  it('snapshot updates when document is modified', async () => {
    const colRef = collection(db, 'scores');
    await setDoc(doc(colRef, 's1'), { player: 'Alice', score: 100 });

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Update document
    await updateDoc(doc(colRef, 's1'), { score: 200 });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].docs[0].data().score).toBe(100);
    expect(snapshots[snapshots.length - 1].docs[0].data().score).toBe(200);
  });

  it('snapshot updates when document is deleted', async () => {
    const colRef = collection(db, 'toDelete');
    await setDoc(doc(colRef, 'd1'), { value: 1 });
    await setDoc(doc(colRef, 'd2'), { value: 2 });

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Delete a document
    await deleteDoc(doc(colRef, 'd1'));

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].size).toBe(2);
    expect(snapshots[snapshots.length - 1].size).toBe(1);
  });

  it('docChanges() returns changed documents', async () => {
    const colRef = collection(db, 'changes');
    await setDoc(doc(colRef, 'c1'), { val: 'a' });

    const allChanges: Array<{ type: string; id: string }> = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    let callCount = 0;

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      callCount++;
      const changes = snapshot.docChanges();
      for (const change of changes) {
        allChanges.push({ type: change.type, id: change.doc.id });
      }
      if (callCount >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1));

    // Add a document
    await setDoc(doc(colRef, 'c2'), { val: 'b' });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    // Should have 'added' for initial doc, then 'added' for new doc
    expect(allChanges.find(c => c.id === 'c1' && c.type === 'added')).toBeDefined();
    expect(allChanges.find(c => c.id === 'c2' && c.type === 'added')).toBeDefined();
  });
});

describe('Firestore Realtime: Query onSnapshot', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'realtime-query-test',
    };
    app = initializeApp(config, `realtime-query-test-${Date.now()}`);
    db = getFirestore(app);

    // Seed test data
    const colRef = collection(db, 'tasks');
    await setDoc(doc(colRef, 't1'), { title: 'Task 1', status: 'pending', priority: 1 });
    await setDoc(doc(colRef, 't2'), { title: 'Task 2', status: 'done', priority: 2 });
    await setDoc(doc(colRef, 't3'), { title: 'Task 3', status: 'pending', priority: 3 });
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('initial snapshot matches query filter', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, where('status', '==', 'pending'));

    const snapshots: QuerySnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshots.push(snapshot);
        unsubscribe();
        resolve();
      });
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].size).toBe(2); // t1 and t3
    snapshots[0].forEach(doc => {
      expect(doc.data().status).toBe('pending');
    });
  });

  it('snapshot updates when matching document is added', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, where('status', '==', 'pending'));

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Add matching document
    await setDoc(doc(colRef, 't4'), { title: 'Task 4', status: 'pending', priority: 4 });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots[0].size).toBe(2);
    expect(snapshots[snapshots.length - 1].size).toBe(3);
  });

  it('snapshot updates when non-matching document is added (no change)', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, where('status', '==', 'pending'));

    const snapshots: QuerySnapshot[] = [];

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshots.push(snapshot);
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    const initialSize = snapshots[0].size;

    // Add non-matching document
    await setDoc(doc(colRef, 't5'), { title: 'Task 5', status: 'done', priority: 5 });

    // Wait a bit - there may or may not be a snapshot, but size should not change
    await new Promise((r) => setTimeout(r, 50));

    unsubscribe();

    // Either we got one snapshot (no change) or multiple with same size
    const finalSnapshot = snapshots[snapshots.length - 1];
    expect(finalSnapshot.size).toBe(initialSize);
  });

  it('snapshot updates when document changes to match query', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, where('status', '==', 'pending'));

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Change t2 from 'done' to 'pending'
    await updateDoc(doc(colRef, 't2'), { status: 'pending' });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots[0].size).toBe(2);
    expect(snapshots[snapshots.length - 1].size).toBe(3);
  });

  it('snapshot updates when document changes to not match query', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, where('status', '==', 'pending'));

    const snapshots: QuerySnapshot[] = [];
    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshot
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThanOrEqual(1));

    // Change t1 from 'pending' to 'done'
    await updateDoc(doc(colRef, 't1'), { status: 'done' });

    // Wait for update snapshot
    await waitForUpdates;
    unsubscribe();

    expect(snapshots[0].size).toBe(2);
    expect(snapshots[snapshots.length - 1].size).toBe(1);
  });

  it('snapshot respects orderBy and limit', async () => {
    const colRef = collection(db, 'tasks');
    const q = query(colRef, orderBy('priority'), limit(2));

    const snapshots: QuerySnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshots.push(snapshot);
        unsubscribe();
        resolve();
      });
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].size).toBe(2);
    const priorities = snapshots[0].docs.map(d => d.data().priority);
    expect(priorities).toEqual([1, 2]);
  });
});

describe('Firestore Realtime: Error Handling', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'realtime-error-test',
    };
    app = initializeApp(config, `realtime-error-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('error callback receives errors', async () => {
    // This test ensures the error callback signature is supported
    // In our in-memory implementation, errors are rare
    const docRef = doc(db, 'users', 'user1');
    await setDoc(docRef, { name: 'Test' });

    const errors: Error[] = [];
    const snapshots: DocumentSnapshot[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(
        docRef,
        (snapshot) => {
          snapshots.push(snapshot);
          unsubscribe();
          resolve();
        },
        (error) => {
          errors.push(error);
        }
      );
    });

    // No error expected in normal operation
    expect(errors).toHaveLength(0);
    expect(snapshots).toHaveLength(1);
  });

  it('observer object form works', async () => {
    const docRef = doc(db, 'users', 'user2');
    await setDoc(docRef, { name: 'Observer Test' });

    const snapshots: DocumentSnapshot[] = [];
    const errors: Error[] = [];

    await new Promise<void>((resolve) => {
      const unsubscribe = onSnapshot(docRef, {
        next: (snapshot) => {
          snapshots.push(snapshot);
          unsubscribe();
          resolve();
        },
        error: (error) => {
          errors.push(error);
        },
      });
    });

    expect(errors).toHaveLength(0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].data()?.name).toBe('Observer Test');
  });
});

describe('Firestore Realtime: Multiple Listeners', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'realtime-multi-test',
    };
    app = initializeApp(config, `realtime-multi-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('can have multiple listeners on same document', async () => {
    const docRef = doc(db, 'shared', 'doc1');
    await setDoc(docRef, { value: 1 });

    const snapshots1: DocumentSnapshot[] = [];
    const snapshots2: DocumentSnapshot[] = [];

    const unsubscribe1 = onSnapshot(docRef, (snapshot) => {
      snapshots1.push(snapshot);
    });

    const unsubscribe2 = onSnapshot(docRef, (snapshot) => {
      snapshots2.push(snapshot);
    });

    // Wait for initial snapshots
    await vi.waitFor(() => expect(snapshots1.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(snapshots2.length).toBeGreaterThanOrEqual(1));

    unsubscribe1();
    unsubscribe2();

    expect(snapshots1).toHaveLength(1);
    expect(snapshots2).toHaveLength(1);
    expect(snapshots1[0].data()).toEqual({ value: 1 });
    expect(snapshots2[0].data()).toEqual({ value: 1 });
  });

  it('listeners fire independently on updates', async () => {
    const docRef = doc(db, 'shared', 'doc2');
    await setDoc(docRef, { count: 0 });

    const snapshots1: DocumentSnapshot[] = [];
    const snapshots2: DocumentSnapshot[] = [];

    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe1 = onSnapshot(docRef, (snapshot) => {
      snapshots1.push(snapshot);
      if (snapshots1.length >= 2 && snapshots2.length >= 2) {
        resolvePromise();
      }
    });

    const unsubscribe2 = onSnapshot(docRef, (snapshot) => {
      snapshots2.push(snapshot);
      if (snapshots1.length >= 2 && snapshots2.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshots
    await vi.waitFor(() => expect(snapshots1.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(snapshots2.length).toBeGreaterThanOrEqual(1));

    // Update
    await updateDoc(docRef, { count: 1 });

    // Wait for updates
    await waitForUpdates;

    unsubscribe1();
    unsubscribe2();

    expect(snapshots1.length).toBeGreaterThanOrEqual(2);
    expect(snapshots2.length).toBeGreaterThanOrEqual(2);
  });

  it('unsubscribing one listener does not affect others', async () => {
    const docRef = doc(db, 'shared', 'doc3');
    await setDoc(docRef, { val: 'a' });

    const snapshots1: DocumentSnapshot[] = [];
    const snapshots2: DocumentSnapshot[] = [];

    let resolvePromise: () => void;
    const waitForUpdates = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const unsubscribe1 = onSnapshot(docRef, (snapshot) => {
      snapshots1.push(snapshot);
    });

    const unsubscribe2 = onSnapshot(docRef, (snapshot) => {
      snapshots2.push(snapshot);
      if (snapshots2.length >= 2) {
        resolvePromise();
      }
    });

    // Wait for initial snapshots
    await vi.waitFor(() => expect(snapshots1.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(snapshots2.length).toBeGreaterThanOrEqual(1));

    // Unsubscribe first listener
    unsubscribe1();

    // Update document
    await updateDoc(docRef, { val: 'b' });

    // Wait for second listener to get update
    await waitForUpdates;

    unsubscribe2();

    // First listener should have only initial snapshot
    expect(snapshots1).toHaveLength(1);
    // Second listener should have both
    expect(snapshots2.length).toBeGreaterThanOrEqual(2);
  });

  it('can have listeners on different documents', async () => {
    const doc1Ref = doc(db, 'multi', 'doc1');
    const doc2Ref = doc(db, 'multi', 'doc2');
    await setDoc(doc1Ref, { name: 'Doc 1' });
    await setDoc(doc2Ref, { name: 'Doc 2' });

    const snapshots1: DocumentSnapshot[] = [];
    const snapshots2: DocumentSnapshot[] = [];

    const unsubscribe1 = onSnapshot(doc1Ref, (snapshot) => {
      snapshots1.push(snapshot);
    });

    const unsubscribe2 = onSnapshot(doc2Ref, (snapshot) => {
      snapshots2.push(snapshot);
    });

    // Wait for initial snapshots
    await vi.waitFor(() => expect(snapshots1.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(snapshots2.length).toBeGreaterThanOrEqual(1));

    unsubscribe1();
    unsubscribe2();

    expect(snapshots1[0].data()?.name).toBe('Doc 1');
    expect(snapshots2[0].data()?.name).toBe('Doc 2');
  });

  it('can have listeners on document and collection simultaneously', async () => {
    const colRef = collection(db, 'combined');
    const docRef = doc(colRef, 'specific');
    await setDoc(docRef, { type: 'specific' });
    await setDoc(doc(colRef, 'other'), { type: 'other' });

    const docSnapshots: DocumentSnapshot[] = [];
    const colSnapshots: QuerySnapshot[] = [];

    const unsubscribeDoc = onSnapshot(docRef, (snapshot) => {
      docSnapshots.push(snapshot);
    });

    const unsubscribeCol = onSnapshot(colRef, (snapshot) => {
      colSnapshots.push(snapshot);
    });

    // Wait for initial snapshots
    await vi.waitFor(() => expect(docSnapshots.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() => expect(colSnapshots.length).toBeGreaterThanOrEqual(1));

    unsubscribeDoc();
    unsubscribeCol();

    expect(docSnapshots[0].data()?.type).toBe('specific');
    expect(colSnapshots[0].size).toBe(2);
  });
});
